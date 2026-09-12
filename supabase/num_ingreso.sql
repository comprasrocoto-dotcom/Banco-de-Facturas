alter table facturas add column if not exists num_ingreso text;
drop view if exists facturas_busqueda;
drop view if exists facturas_visibles;
create view facturas_visibles with (security_invoker = true) as
  select * from facturas where categoria in ('insumos','empaque','aseo','loza_utensilios');
create view facturas_busqueda with (security_invoker = true) as
  select f.*,
         coalesce(nullif(trim(coalesce(prefijo,'') || coalesce(folio,'')), ''), documento, cufe) as numero,
         (select count(*) from novedades n where n.cufe = f.cufe) as novedades
  from facturas_visibles f;
grant select on facturas_visibles, facturas_busqueda to authenticated;