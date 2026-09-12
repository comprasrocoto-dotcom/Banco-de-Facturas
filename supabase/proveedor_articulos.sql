create or replace view proveedor_articulos with (security_invoker = true) as
  select p.proveedor_texto as proveedor,
         p.nit_proveedor   as nit,
         l.codigo          as codigo,
         l.insumo          as insumo,
         count(*)          as veces,
         max(p.fecha)      as ultima
  from pedidos p
  join pedido_lineas l on l.pedido_id = p.id
  where l.codigo is not null or l.insumo is not null
  group by 1,2,3,4;
grant select on proveedor_articulos to authenticated;
