-- ============================================================
--  organizador_hiopos.sql  -  LISTAS DEL ORGANIZADOR HIOPOS  -  09/10/2026   ADITIVO
--  Hiopos no trae ningun dato que diga "cuenta de cobro" ni "pagado de contado". El usuario decidio (09/10/2026) que se
--  definan por PROVEEDOR: cada Contacto del Excel de Hiopos puede estar en la lista "cobra con cuenta de cobro" y/o en
--  "se paga por caja menor". Se guarda aqui y se aplica igual cada vez que se organiza un Excel.
--  La clave es el nombre del Contacto normalizado (sin tildes, mayusculas ni signos), como lo compara el organizador.
--  Solo admin y pagos leen y cambian. No toca ninguna tabla existente.
-- ============================================================
create table if not exists hiopos_contacto_regla (
  contacto_norm  text primary key,
  contacto       text not null,
  cuenta_cobro   boolean not null default false,
  caja_menor     boolean not null default false,
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);
alter table hiopos_contacto_regla enable row level security;
drop policy if exists hcr_leer on hiopos_contacto_regla;
create policy hcr_leer on hiopos_contacto_regla for select to authenticated using (mi_rol() in ('admin', 'pagos'));
drop policy if exists hcr_escribir on hiopos_contacto_regla;
create policy hcr_escribir on hiopos_contacto_regla for all to authenticated using (mi_rol() in ('admin', 'pagos')) with check (mi_rol() in ('admin', 'pagos'));
revoke all on hiopos_contacto_regla from anon;
grant select, insert, update, delete on hiopos_contacto_regla to authenticated;
