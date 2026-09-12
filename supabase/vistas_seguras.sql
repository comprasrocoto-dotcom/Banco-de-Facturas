
-- Sin security_invoker, una vista corre como su dueño y SE SALTA el RLS:
-- cualquier sede vería las facturas de todas las marcas. Esto lo cierra.
create or replace view facturas_visibles with (security_invoker = true) as
  select * from facturas
  where categoria in ('insumos','empaque','aseo','loza_utensilios');

create or replace view facturas_busqueda with (security_invoker = true) as
  select f.*,
         coalesce(nullif(trim(coalesce(prefijo,'') || coalesce(folio,'')), ''), documento, cufe) as numero,
         (select count(*) from novedades n where n.cufe = f.cufe) as novedades
  from facturas_visibles f;

grant select on facturas_visibles, facturas_busqueda to authenticated;
