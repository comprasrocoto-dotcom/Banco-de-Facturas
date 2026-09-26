-- ============================================================
--  COLA DE INGRESOS AL ERP: ESTADO POR DOCUMENTO, CANDADO, PROGRESO Y DETENER  -  26/09/2026
--  Hoy el agente decide que procesar con consultas sueltas y solo la ORDEN tiene estado. Aqui se agrega, SIN cambiar lo existente:
--   - ingreso_documento : UNA fila por pedido con su estado (PENDIENTE, PROCESANDO, PEDIDO_CREADO, FACTURANDO, COMPLETADO, ERROR, PENDIENTE_REINTENTO), etapa, error y latido.
--                         Es el CANDADO por documento: nadie mas (ni otro PC) toma un documento que esta PROCESANDO, ni uno ya COMPLETADO.
--   - ordenes.progreso  : lo que la web muestra en vivo (n de total, actual, etapa, completadas, errores, pendientes)
--   - ordenes.detener   : el usuario pide parar; el agente termina el documento en curso y se detiene (nada a medias)
--   - ordenes.tomada_por: que PC tomo la orden (varios analistas, cada uno con su agente)
--   - orden_tomar()     : toma la siguiente orden de forma ATOMICA (antes se leia y luego se marcaba: dos PCs podian tomar la misma)
--  Las funciones del agente solo las puede llamar el agente (service_role); las de la web exigen el permiso ingresos.iniciar.
-- ============================================================
alter table ordenes add column if not exists progreso jsonb;
alter table ordenes add column if not exists detener boolean not null default false;
alter table ordenes add column if not exists tomada_por text;

create table if not exists ingreso_documento (
  pedido_id     bigint primary key references pedidos(id) on delete cascade,
  numero        text,
  factura_cufe  text,
  orden_id      bigint,
  estado        text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'PROCESANDO', 'PEDIDO_CREADO', 'FACTURANDO', 'COMPLETADO', 'ERROR', 'PENDIENTE_REINTENTO')),
  etapa         text,
  error_etapa   text,
  error         text,
  intentos      int not null default 0,
  tomado_por    text,
  iniciado_en   timestamptz,
  actualizado_en timestamptz not null default now(),
  terminado_en  timestamptz
);
create index if not exists ingreso_documento_estado_idx on ingreso_documento (estado);
alter table ingreso_documento enable row level security;
drop policy if exists id_leer on ingreso_documento;
create policy id_leer on ingreso_documento for select to authenticated using (mi_rol() = any (array['admin', 'pagos']));
revoke all on ingreso_documento from anon;
grant select on ingreso_documento to authenticated;

-- TOMAR un documento (candado). true = es tuyo; false = ya esta COMPLETADO, en ERROR (espera que una persona pida reintentar) o lo tiene otro proceso con latido reciente.
-- Un documento en proceso con latido vencido (el proceso murio) SI se puede retomar: asi una sesion caida continua donde quedo, sin empezar de cero.
create or replace function ingreso_tomar(p_pedido_id bigint, p_numero text, p_cufe text, p_orden_id bigint, p_host text, p_vence_min int default 30)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente' using errcode = '42501'; end if;
  insert into ingreso_documento (pedido_id, numero, factura_cufe, orden_id, estado, etapa, tomado_por, iniciado_en, actualizado_en, intentos)
  values (p_pedido_id, p_numero, p_cufe, p_orden_id, 'PROCESANDO', 'tomado', p_host, now(), now(), 1)
  on conflict (pedido_id) do update set
    estado = 'PROCESANDO', etapa = 'tomado', orden_id = excluded.orden_id, tomado_por = excluded.tomado_por, iniciado_en = now(), actualizado_en = now(),
    intentos = ingreso_documento.intentos + 1, error = null, error_etapa = null, terminado_en = null,
    numero = coalesce(excluded.numero, ingreso_documento.numero), factura_cufe = coalesce(excluded.factura_cufe, ingreso_documento.factura_cufe)
  where ingreso_documento.estado in ('PENDIENTE', 'PENDIENTE_REINTENTO')
     or (ingreso_documento.estado in ('PROCESANDO', 'PEDIDO_CREADO', 'FACTURANDO') and ingreso_documento.actualizado_en < now() - make_interval(mins => greatest(1, coalesce(p_vence_min, 30))));
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$fn$;

-- AVANZAR el estado de un documento (y renovar su latido). Un COMPLETADO no cambia nunca.
create or replace function ingreso_avanzar(p_pedido_id bigint, p_estado text, p_etapa text default null, p_error_etapa text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente' using errcode = '42501'; end if;
  update ingreso_documento set estado = p_estado, etapa = coalesce(p_etapa, etapa), error_etapa = p_error_etapa, error = left(p_error, 500), actualizado_en = now(),
         terminado_en = case when p_estado in ('COMPLETADO', 'ERROR') then now() else null end
   where pedido_id = p_pedido_id and estado <> 'COMPLETADO';
end
$fn$;

-- Si una orden termina o muere, lo que quedo a medias vuelve a la cola (se retoma en la proxima orden)
create or replace function ingreso_liberar_orden(p_orden_id bigint) returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente' using errcode = '42501'; end if;
  update ingreso_documento set estado = 'PENDIENTE_REINTENTO', etapa = 'liberado: la orden termino a medias', actualizado_en = now()
   where orden_id = p_orden_id and estado in ('PROCESANDO', 'PEDIDO_CREADO', 'FACTURANDO');
  get diagnostics v_n = row_count; return v_n;
end
$fn$;

-- Toma la siguiente orden pendiente de forma atomica (dos vigilantes no pueden tomar la misma)
create or replace function orden_tomar(p_host text) returns setof ordenes
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente' using errcode = '42501'; end if;
  return query update ordenes set estado = 'corriendo', tomada_en = now(), tomada_por = p_host, detener = false, progreso = null
    where id = (select o.id from ordenes o where o.estado = 'pendiente' order by o.id limit 1 for update skip locked) returning *;
end
$fn$;

-- DETENER (web): el agente termina el documento en curso y se detiene. Si la orden aun no la tomo nadie, se cancela.
create or replace function orden_detener(p_id bigint) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not tiene_permiso('ingresos.iniciar') then raise exception 'sin permiso para detener el ingreso' using errcode = '42501'; end if;
  update ordenes set detener = true where id = p_id and estado = 'corriendo';
  update ordenes set detener = true, estado = 'terminado', terminada_en = now(), resultado = 'Cancelada por el usuario antes de empezar' where id = p_id and estado = 'pendiente';
end
$fn$;

-- REINTENTAR ERRORES (web): los documentos en ERROR vuelven a la cola; los COMPLETADOS no se tocan
create or replace function ingreso_reintentar_errores() returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not tiene_permiso('ingresos.iniciar') then raise exception 'sin permiso para reintentar' using errcode = '42501'; end if;
  update ingreso_documento set estado = 'PENDIENTE_REINTENTO', etapa = 'reintento pedido por el usuario', actualizado_en = now() where estado = 'ERROR';
  get diagnostics v_n = row_count; return v_n;
end
$fn$;

revoke all on function ingreso_tomar(bigint, text, text, bigint, text, int), ingreso_avanzar(bigint, text, text, text, text), ingreso_liberar_orden(bigint), orden_tomar(text) from public, anon, authenticated;
grant execute on function ingreso_tomar(bigint, text, text, bigint, text, int), ingreso_avanzar(bigint, text, text, text, text), ingreso_liberar_orden(bigint), orden_tomar(text) to service_role;
revoke all on function orden_detener(bigint), ingreso_reintentar_errores() from public, anon;
grant execute on function orden_detener(bigint), ingreso_reintentar_errores() to authenticated;
