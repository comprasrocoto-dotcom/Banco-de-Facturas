
-- 1) la planta de produccion es una sede de Rocoto
insert into sedes (marca_id, nombre)
  select id, 'Planta de Producción' from marcas where nombre = 'Rocoto'
  on conflict (marca_id, nombre) do nothing;

update pedidos p set sede_id = s.id, marca_id = m.id
from sedes s join marcas m on m.id = s.marca_id
where p.sede_id is null and p.sede_texto = 'PLANTA PRODUCCION ROCOTO'
  and s.nombre = 'Planta de Producción' and m.nombre = 'Rocoto';

-- 2) AMARRE AUTOMATICO pedido <-> factura por el numero (se puede repetir: solo amarra lo que falta)
update pedidos p
   set factura_cufe = f.cufe
from facturas f
where p.factura_cufe is null
  and p.numero_factura is not null
  and upper(trim(p.numero_factura)) = upper(trim(coalesce(f.prefijo,'') || coalesce(f.folio,'')));
