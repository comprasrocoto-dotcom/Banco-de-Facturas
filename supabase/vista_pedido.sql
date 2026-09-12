drop view if exists facturas_busqueda;
drop view if exists facturas_visibles;
create view facturas_visibles with (security_invoker = true) as
  select * from facturas where categoria in ('insumos','empaque','aseo','loza_utensilios');
create view facturas_busqueda with (security_invoker = true) as
  select f.*,
         coalesce(nullif(trim(coalesce(prefijo,'') || coalesce(folio,'')), ''), documento, cufe) as numero,
         (select count(*) from novedades n where n.cufe = f.cufe) as novedades,
         (select p.numero     from pedidos p where p.factura_cufe = f.cufe limit 1) as pedido_num,
         (select p.pedido_erp from pedidos p where p.factura_cufe = f.cufe limit 1) as pedido_erp
  from facturas_visibles f;
grant select on facturas_visibles, facturas_busqueda to authenticated;
