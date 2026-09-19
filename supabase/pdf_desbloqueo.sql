-- ============================================================
--  DESBLOQUEO AUTOMATICO DE PDF   (18/09/2026)
--  Los PDF de la DIAN vienen protegidos; la clave es el NIT de la marca/empresa receptora (solo digitos, sin DV).
--  SOLO ADITIVO e idempotente. NO guarda ninguna clave: el NIT vive en marcas.nit y la clave se arma al momento.
--
--  pdf_config : ajustes del proceso (formato de la clave). Sin fila = 'nit_sin_dv'.
--  pdf_proceso: registro de cada etapa por documento (descargado, protegido, desbloqueando, desbloqueado, validado, subido, errores).
--               Nunca guarda el NIT completo ni la clave: solo el NIT enmascarado (ej. ******083).
-- ============================================================
create table if not exists pdf_config (
  clave       text primary key,
  valor       text not null,
  descripcion text,
  actualizado_en timestamptz not null default now()
);
insert into pdf_config (clave, valor, descripcion) values
  ('formato_clave', 'nit_sin_dv', 'Como se arma la clave del PDF a partir de marcas.nit: nit_sin_dv | nit_con_dv | nit_con_guion')
on conflict (clave) do nothing;

create table if not exists pdf_proceso (
  id                        bigserial primary key,
  creado_en                 timestamptz not null default now(),      -- fecha y hora del evento
  dian_descarga_id          bigint,
  cufe                      text,
  documento                 text,
  tipo                      text,                                    -- factura | nota_credito
  marca                     text,
  sede                      text,
  nombre_pdf_original       text,
  nombre_pdf_desbloqueado   text,
  etapa                     text not null check (etapa in ('PDF DESCARGADO','PDF PROTEGIDO','PDF SIN CLAVE','DESBLOQUEANDO','PDF DESBLOQUEADO','PDF VALIDADO','PDF SUBIDO','ERROR DESBLOQUEANDO','ERROR SUBIENDO')),
  resultado                 text,                                    -- ok | error
  cantidad_intentos         int not null default 0,
  codigo_error              text,                                    -- CLAVE_INVALIDA | MARCA_NO_IDENTIFICADA | MARCA_SIN_NIT | PDF_CORRUPTO | VALIDACION_FALLIDA | SIN_HERRAMIENTA | SUBIDA_FALLIDA
  error                     text,
  nit_enmascarado           text,
  origen_marca              text                                     -- nit_receptor | marca_asignada
);
create index if not exists ix_pdf_proceso_cufe on pdf_proceso (cufe, id);
create index if not exists ix_pdf_proceso_fecha on pdf_proceso (creado_en desc);
alter table pdf_config  enable row level security;
alter table pdf_proceso enable row level security;
drop policy if exists pdf_config_leer on pdf_config;
create policy pdf_config_leer on pdf_config for select to authenticated using (mi_rol() in ('admin','pagos'));
drop policy if exists pdf_proceso_leer on pdf_proceso;
create policy pdf_proceso_leer on pdf_proceso for select to authenticated using (mi_rol() in ('admin','pagos'));
-- Solo el agente (service_role, que salta RLS) escribe en estas tablas.

-- ---------- registro desde la WEB (carga manual): solo admin/pagos, con las mismas etapas; rechaza un NIT completo por descuido ----------
create or replace function pdf_proceso_registrar(p_eventos jsonb) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para registrar el proceso de PDF'; end if;
  if p_eventos is null or jsonb_typeof(p_eventos) <> 'array' then raise exception 'p_eventos debe ser una lista'; end if;
  if jsonb_array_length(p_eventos) > 200 then raise exception 'maximo 200 eventos por llamada'; end if;
  if exists (select 1 from jsonb_to_recordset(p_eventos) as x(nit_enmascarado text) where x.nit_enmascarado ~ '[0-9]{5,}') then raise exception 'el NIT debe ir enmascarado'; end if;
  insert into pdf_proceso (cufe, documento, tipo, marca, sede, nombre_pdf_original, nombre_pdf_desbloqueado, etapa, resultado, cantidad_intentos, codigo_error, error, nit_enmascarado, origen_marca)
  select lower(x.cufe), left(x.documento, 100), left(coalesce(x.tipo, 'factura'), 30), left(x.marca, 100), left(x.sede, 100), left(x.nombre_pdf_original, 200), left(x.nombre_pdf_desbloqueado, 200),
         x.etapa, left(x.resultado, 20), coalesce(x.cantidad_intentos, 0), left(x.codigo_error, 40), left(x.error, 500), left(x.nit_enmascarado, 30), left(x.origen_marca, 30)
    from jsonb_to_recordset(p_eventos) as x(cufe text, documento text, tipo text, marca text, sede text, nombre_pdf_original text, nombre_pdf_desbloqueado text, etapa text, resultado text,
                                              cantidad_intentos int, codigo_error text, error text, nit_enmascarado text, origen_marca text);
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function pdf_proceso_registrar(jsonb) from public, anon;
grant execute on function pdf_proceso_registrar(jsonb) to authenticated, service_role;

-- ---------- marcas: el NIT es la clave de los PDF, asi que la tabla ya no se lee sin sesion (aplicado 18/09/2026) ----------
alter table marcas enable row level security;
drop policy if exists marcas_leer on marcas;
create policy marcas_leer on marcas for select to authenticated using (true);
