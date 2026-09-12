drop policy if exists linea_editar on pedido_lineas;
create policy linea_editar on pedido_lineas for update to authenticated
  using (mi_rol() in ('admin','pagos') or pedido_id in (select id from pedidos where sede_id = mi_sede()))
  with check (mi_rol() in ('admin','pagos') or pedido_id in (select id from pedidos where sede_id = mi_sede()));
drop policy if exists linea_borrar on pedido_lineas;
create policy linea_borrar on pedido_lineas for delete to authenticated
  using (mi_rol() in ('admin','pagos') or pedido_id in (select id from pedidos where sede_id = mi_sede()));
