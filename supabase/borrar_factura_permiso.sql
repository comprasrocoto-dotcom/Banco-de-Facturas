-- ============================================================
--  BORRAR FACTURAS CON EL PERMISO «facturas.borrar»  -  04/11/2026, pedido del usuario: «al borrar una factura no queda
--  eliminada del sistema»
-- ============================================================
-- El permiso «Borrar facturas» (facturas.borrar) se puede dar a un perfil (hoy lo tiene el perfil Analista), pero la base solo
-- dejaba BORRAR al administrador: la regla del permiso era solo restrictiva y no habia una que lo autorizara. El analista le daba
-- «Borrar», la base no borraba nada (sin error) y la web decia «borrada» (ademas ya le habia quitado el PDF y el pedido).
-- Ahora: quien tenga el permiso puede borrar; siguen valiendo las reglas de siempre (sus sedes asignadas o facturas sin sede).
-- Solo AGREGA una regla. Repetirlo no hace nada.
drop policy if exists fact_borrar_con_permiso on public.facturas;
create policy fact_borrar_con_permiso on public.facturas for delete to authenticated using (tiene_permiso('facturas.borrar'));
