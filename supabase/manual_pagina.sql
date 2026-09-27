-- ============================================================
--  manual_pagina.sql  -  MANUALES DE USUARIO CON PERMISOS  (26/09/2026)   ADITIVO: no toca nada existente
--  El administrador decide, desde Admin > Usuarios y perfiles > Perfiles (grupo "Manual"), que manual puede ver cada perfil.
--  El TEXTO de los manuales vive en la tabla manual_pagina y la base solo lo entrega a quien tiene el permiso (RLS): no queda en el repo publico ni en la pagina.
--  Lo escribe el generador (manual/generar-web.js --subir) con la llave de servicio; la web solo lo LEE.
-- ============================================================

-- 1) permisos nuevos (aparecen solos en el editor de perfiles)
insert into permiso_catalogo (permiso, modulo, etiqueta, orden, critico) values
  ('manual.sede',     'Manual', 'Ver el manual de la Sede',          900, false),
  ('manual.analista', 'Manual', 'Ver el manual del Analista',        901, false),
  ('manual.admin',    'Manual', 'Ver el manual del Administrador',   902, false)
on conflict (permiso) do nothing;

-- 2) valores de partida (el admin los cambia cuando quiera): cada perfil ve SU manual; administrador ve los tres
insert into perfil_permiso (perfil_id, permiso)
select pa.id, x.permiso
  from perfil_acceso pa
  join (values ('administrador','manual.sede'), ('administrador','manual.analista'), ('administrador','manual.admin'),
               ('pagos','manual.analista'), ('analista','manual.analista'), ('sede','manual.sede')) as x(clave, permiso) on x.clave = pa.clave
on conflict do nothing;

-- 3) el texto de cada manual
create table if not exists manual_pagina (
  slug           text primary key check (slug in ('sede','analista','admin')),
  titulo         text not null,
  version        text,
  html           text not null,
  actualizado_en timestamptz not null default now()
);
alter table manual_pagina enable row level security;
drop policy if exists manual_leer on manual_pagina;
create policy manual_leer on manual_pagina for select to authenticated using (tiene_permiso('manual.' || slug));
revoke all on manual_pagina from anon, authenticated;
grant select on manual_pagina to authenticated;   -- escribir: solo la llave de servicio (no hay politicas de escritura)
