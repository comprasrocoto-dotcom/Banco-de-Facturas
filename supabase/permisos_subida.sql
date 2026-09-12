
-- permisos para que la pagina pueda SUBIR facturas y PDFs
drop policy if exists fact_insert on facturas;
create policy fact_insert on facturas for insert with check (
  mi_rol() in ('admin','pagos')
  or (mi_rol() = 'sede' and sede_id = mi_sede() and marca_id = mi_marca())
);

-- storage: subir y leer PDFs
drop policy if exists archivo_subir on storage.objects;
create policy archivo_subir on storage.objects for insert with check (
  bucket_id = 'facturas' and auth.role() = 'authenticated');
drop policy if exists archivo_leer on storage.objects;
create policy archivo_leer on storage.objects for select using (
  bucket_id = 'facturas' and auth.role() = 'authenticated');

-- indice para el buscador por numero de factura (prefijo+folio)
create index if not exists idx_fact_folio    on facturas (prefijo, folio);
create index if not exists idx_fact_documento on facturas (documento);

-- y una vista comoda: numero de factura ya armado, para buscar
create or replace view facturas_busqueda as
  select f.*,
         coalesce(nullif(trim(coalesce(prefijo,'') || coalesce(folio,'')), ''), documento, cufe) as numero,
         (select count(*) from novedades n where n.cufe = f.cufe) as novedades
  from facturas_visibles f;
grant select on facturas_busqueda to authenticated;
