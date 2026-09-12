
alter table pedidos add column if not exists proveedor_id bigint references proveedores(id);

update pedidos p set proveedor_id = pr.id
from proveedores pr
where p.proveedor_id is null and p.proveedor_texto is not null
  and upper(regexp_replace(p.proveedor_texto,'[^A-Za-z0-9 ]','','g'))
      like upper(regexp_replace(pr.razon_social,'[^A-Za-z0-9 ]','','g')) || '%';

update pedidos p set proveedor_id = pr.id
from proveedores pr
where p.proveedor_id is null and p.proveedor_texto is not null
  and upper(regexp_replace(pr.razon_social,'[^A-Za-z0-9 ]','','g'))
      like upper(regexp_replace(p.proveedor_texto,'[^A-Za-z0-9 ]','','g')) || '%';

create or replace view proveedor_articulos with (security_invoker = true) as
  select coalesce(p.proveedor_id, 0) as proveedor_id,
         p.proveedor_texto as proveedor,
         l.codigo, l.insumo, count(*) as veces, max(p.fecha) as ultima
  from pedidos p join pedido_lineas l on l.pedido_id = p.id
  where l.codigo is not null or l.insumo is not null
  group by 1,2,3,4;
grant select on proveedor_articulos to authenticated;
