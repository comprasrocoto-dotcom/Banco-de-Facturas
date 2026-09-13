drop policy if exists fact_borrar on facturas;
create policy fact_borrar on facturas for delete to authenticated
  using (mi_rol() = 'admin');

-- si un pedido apunta a una factura que se borra, que quede en null (no que falle)
alter table pedidos drop constraint if exists pedidos_factura_cufe_fkey;
alter table pedidos add constraint pedidos_factura_cufe_fkey
  foreign key (factura_cufe) references facturas(cufe) on delete set null;
