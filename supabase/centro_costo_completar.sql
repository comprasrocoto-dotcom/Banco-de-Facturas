-- ============================================================
--  centro_costo_completar.sql  -  LOS 5 CENTROS DE COSTO EN LAS 3 MARCAS  -  09/10/2026   ADITIVO (no borra nada)
--  El usuario pidio (09/10/2026) que en 123 Wok, Casa de Nadie y Sin Par esten TODOS los centros: Cocina, Bar,
--  Material de aseo, Material de empaque y Utensilios y papeleria, con esos nombres.
--  Series del ERP: FC.COCINA, FC.BAR, FC.ASEO (en Casa de Nadie "FC. ASEO", con espacio, como sale en su informe),
--  FC.EMPAQUES, FC.UTILESYPAPELERIA. Si alguna no existe en el ERP de una marca, el agente NO la reemplaza por otra:
--  deja el documento pendiente de revision con el motivo (hay que crearla en el ERP o corregirla aqui).
-- ============================================================
insert into centro_costo_serie (marca_id, centro, serie_erp, orden)
select m.id, v.centro, case when m.nombre = 'Casa de Nadie' and v.serie = 'FC.ASEO' then 'FC. ASEO' else v.serie end, v.orden
from marcas m
cross join (values
  ('COCINA', 'FC.COCINA', 1), ('BAR', 'FC.BAR', 2), ('MATERIAL DE ASEO', 'FC.ASEO', 3),
  ('MATERIAL DE EMPAQUE', 'FC.EMPAQUES', 4), ('UTENSILIOS Y PAPELERIA', 'FC.UTILESYPAPELERIA', 5)
) as v(centro, serie, orden)
where m.nombre in ('123 wok', 'Casa de Nadie', 'Sin Par')
on conflict (marca_id, serie_erp) do update set centro = excluded.centro, orden = excluded.orden;
