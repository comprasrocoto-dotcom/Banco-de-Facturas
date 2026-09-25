-- ============================================================
--  ENVIAR PEDIDO AL PROVEEDOR (correo + WhatsApp)  -  22/09/2026
--  Reutiliza lo que ya existe: proveedores (nit/correo/telefono1/asesor), pedidos.observacion_pedido, pedido_lineas.unidad, y el correo
--  (correo_cola / correo_encolar, el mismo que ya manda el correo de novedades). SOLO AGREGA:
--   - 1 tabla nueva, pedido_envio: registro de cada intento de envio (por canal), para trazabilidad e historial. No hay tabla equivalente hoy:
--     ninguna registra "se envio este pedido por tal canal a tal destinatario". Sirve a la vez de "estado actual" (la fila mas reciente por canal)
--     y de historial completo (todas las filas), asi no hace falta una segunda tabla para lo mismo.
--   - 1 columna en correo_cola (archivo_pdf, la ruta del PDF en el bucket "facturas" que ya se usa para subir PDFs desde la web) y el parametro
--     correspondiente en correo_encolar. Los correos que no la usan (como el de novedades) siguen exactamente igual.
--  El estado de WhatsApp nunca es "enviado": es un enlace de WhatsApp Web/app que la persona confirma a mano (no hay API oficial contratada).
-- ============================================================
alter table correo_cola add column if not exists archivo_pdf text;

-- OJO: quitar la version vieja (6 parametros). Si conviviera con la nueva (7, con default) las llamadas de 6 parametros nombrados darian "function is not unique".
drop function if exists correo_encolar(text, text, text, text, text, bigint);
create or replace function correo_encolar(
  p_para text, p_asunto text, p_cuerpo text, p_cufe text default null, p_pedido text default null, p_orden bigint default null, p_archivo_pdf text default null
) returns table (correo_id bigint, duplicado boolean)
language plpgsql
security definer
set search_path = public
as $fn$
declare v_key text; v_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'sin permiso para encolar correos';
  end if;
  v_key := md5(lower(trim(p_para)) || '|' || p_asunto || '|' || p_cuerpo) || '|' || to_char(timezone('America/Bogota', now()), 'YYYY-MM-DD');
  insert into correo_cola (destinatario, asunto, cuerpo, factura_cufe, pedido_numero, orden_id, dedupe_key, archivo_pdf)
  values (trim(p_para), p_asunto, p_cuerpo, p_cufe, p_pedido, p_orden, v_key, p_archivo_pdf)
  on conflict (dedupe_key) do nothing
  returning correo_cola.id into v_id;
  if v_id is not null then
    return query select v_id, false; return;
  end if;
  update correo_cola c set estado = 'pendiente', intentos = 0, proximo_intento_en = now(), archivo_pdf = coalesce(p_archivo_pdf, c.archivo_pdf)
   where c.dedupe_key = v_key and c.estado = 'agotado' returning c.id into v_id;
  if v_id is null then select c.id into v_id from correo_cola c where c.dedupe_key = v_key; end if;
  return query select v_id, true;
end
$fn$;
revoke all on function correo_encolar(text, text, text, text, text, bigint, text) from public, anon;
grant execute on function correo_encolar(text, text, text, text, text, bigint, text) to authenticated;

-- Registro de cada intento de envio de un pedido (correo o whatsapp). "Estado actual" de un canal = su fila mas reciente; para correo, el estado
-- real de la entrega se sigue en correo_cola (correo_cola_id) porque el envio es asincrono (lo despacha el vigilante).
create table if not exists pedido_envio (
  id             bigserial primary key,
  pedido_id      bigint not null references pedidos(id) on delete cascade,
  canal          text not null check (canal in ('correo', 'whatsapp')),
  destinatario   text not null,
  estado         text not null default 'pendiente',
  error          text,
  correo_cola_id bigint references correo_cola(id),
  creado_por     uuid,
  creado_en      timestamptz not null default now()
);
create index if not exists pedido_envio_pedido_idx on pedido_envio (pedido_id, creado_en desc);

alter table pedido_envio enable row level security;
drop policy if exists pe_leer on pedido_envio;
create policy pe_leer on pedido_envio for select to authenticated using (
  exists (select 1 from pedidos p where p.id = pedido_envio.pedido_id
    and (mi_rol() = any (array['admin', 'pagos']) or (mi_rol() = 'sede' and (p.sede_id = mi_sede() or p.marca_id = mi_marca()))))
);
revoke all on pedido_envio from anon;
grant select on pedido_envio to authenticated;

-- Registra un intento de envio (uno por cada vez que se manda o se reenvia: nunca se actualiza uno viejo, asi el historial queda completo).
-- Mismo permiso que ya tiene "amarrar/crear" un pedido: admin/pagos siempre, o la sede si el pedido es suyo. p_error = motivo tecnico si fallo (sin secretos).
drop function if exists pedido_envio_registrar(bigint, text, text, text, bigint);
create or replace function pedido_envio_registrar(p_pedido_id bigint, p_canal text, p_destinatario text, p_estado text default 'pendiente', p_correo_cola_id bigint default null, p_error text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare v_id bigint; v_ok boolean;
begin
  select (mi_rol() = any (array['admin', 'pagos']) or (mi_rol() = 'sede' and (p.sede_id = mi_sede() or p.marca_id = mi_marca())))
    into v_ok from pedidos p where p.id = p_pedido_id;
  if v_ok is not true then raise exception 'sin permiso para registrar el envio de este pedido' using errcode = '42501'; end if;
  if p_canal not in ('correo', 'whatsapp') then raise exception 'canal invalido: %', p_canal using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_destinatario, '')), '') is null then raise exception 'falta el destinatario' using errcode = '22023'; end if;
  insert into pedido_envio (pedido_id, canal, destinatario, estado, error, correo_cola_id, creado_por)
  values (p_pedido_id, p_canal, btrim(p_destinatario), coalesce(nullif(btrim(p_estado), ''), 'pendiente'), nullif(left(btrim(coalesce(p_error, '')), 500), ''), p_correo_cola_id, auth.uid())
  returning id into v_id;
  return v_id;
end
$fn$;
revoke all on function pedido_envio_registrar(bigint, text, text, text, bigint, text) from public, anon;
grant execute on function pedido_envio_registrar(bigint, text, text, text, bigint, text) to authenticated;
