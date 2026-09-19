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
