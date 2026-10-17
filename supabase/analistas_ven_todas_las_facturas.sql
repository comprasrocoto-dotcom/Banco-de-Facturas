-- ============================================================
--  LOS ANALISTAS VEN TODAS LAS FACTURAS DEL BANCO (16/10/2026, pedido del usuario)
-- ============================================================
-- "Los analistas deben tener acceso a todas las facturas del banco, para poder dar seguimiento a las facturas no asignadas."
-- Antes (analista_sedes.sql) la politica restrictiva rs_facturas limitaba al analista con sedes asignadas a SUS sedes + las sin
-- sede, para TODO (ver, crear, cambiar, borrar). Ahora VER queda libre (todas las facturas); CREAR, CAMBIAR y BORRAR siguen
-- limitados a sus sedes + las sin sede (misma condicion de antes). Las descargas de cada analista siguen saliendo solo con sus
-- sedes (js/analista-sedes.js paraExportar). Pedidos, novedades y demas tablas no cambian.
drop policy if exists rs_facturas on facturas;
drop policy if exists rs_facturas_insertar on facturas;
create policy rs_facturas_insertar on facturas as restrictive for insert to authenticated
  with check ((select not analista_restringido()) or sede_id is null or sede_id = any ((select analista_sedes())::int[]));
drop policy if exists rs_facturas_cambiar on facturas;
create policy rs_facturas_cambiar on facturas as restrictive for update to authenticated
  using ((select not analista_restringido()) or sede_id is null or sede_id = any ((select analista_sedes())::int[]))
  with check ((select not analista_restringido()) or sede_id is null or sede_id = any ((select analista_sedes())::int[]));
drop policy if exists rs_facturas_borrar on facturas;
create policy rs_facturas_borrar on facturas as restrictive for delete to authenticated
  using ((select not analista_restringido()) or sede_id is null or sede_id = any ((select analista_sedes())::int[]));
