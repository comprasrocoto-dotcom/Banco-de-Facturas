-- ============================================================
--  PROVEEDORES DE SERVICIOS (NO SON DE INSUMO)  -  04/11/2026, pedido del usuario:
--  «dame la opción de sacar los proveedores que no son de insumo» / «marcar qué proveedor es de servicios, no de insumos»
-- ============================================================
-- Por NIT (sirve aunque el proveedor no este en la lista de proveedores, ej. Almacenes Éxito). Sus facturas NO se borran: la web
-- las aparta de «Sin asignar» y de las demás listas y las muestra en «🧾 Servicios». Se puede desmarcar cuando se quiera.
-- Marcan o desmarcan el administrador y los analistas; todos los usuarios con sesión pueden leer la lista (para apartar).
-- Solo AGREGA una tabla. Repetirlo no hace nada.
create table if not exists public.proveedor_servicio (
  nit text primary key check (nit ~ '^[0-9]{5,15}$'),
  nombre text,
  marcado_por text,
  creado_en timestamptz not null default now()
);
alter table public.proveedor_servicio enable row level security;
drop policy if exists ps_leer on public.proveedor_servicio;
create policy ps_leer on public.proveedor_servicio for select to authenticated using ((select mi_rol() as mi_rol) <> 'inactivo');
drop policy if exists ps_marcar on public.proveedor_servicio;
create policy ps_marcar on public.proveedor_servicio for insert to authenticated with check ((select mi_rol() as mi_rol) = any (array['admin', 'pagos']));
drop policy if exists ps_desmarcar on public.proveedor_servicio;
create policy ps_desmarcar on public.proveedor_servicio for delete to authenticated using ((select mi_rol() as mi_rol) = any (array['admin', 'pagos']));
grant select, insert, delete on public.proveedor_servicio to authenticated;
