drop policy if exists ped_crear on pedidos;
create policy ped_crear on pedidos for insert to authenticated
  with check (mi_rol() in ('admin','pagos') or (mi_rol()='sede' and sede_id = mi_sede()));
drop policy if exists linea_crear on pedido_lineas;
create policy linea_crear on pedido_lineas for insert to authenticated
  with check (mi_rol() in ('admin','pagos') or pedido_id in (select id from pedidos where sede_id = mi_sede()));
