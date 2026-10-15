-- ============================================================
--  UNIDAD DEL PROVEEDOR por articulo (14/10/2026, pedido del usuario)
-- ============================================================
-- Ej. vinos de Sin Par: en el POS la unidad de compra es UNDX5C (UNA botella que rinde 5 copas), pero el proveedor vende y
-- factura por UNIDAD. La orden de compra le llega en SU unidad y el ingreso al ERP se hace en la unidad del POS.
--   unidad_proveedor: como la llama el proveedor (UNIDAD, CAJA...)
--   factor_proveedor: cuantas unidades del proveedor son 1 unidad del POS (1 UNDX5C = 1 UNIDAD -> 1; caja de 6 -> 6)
-- Solo aditivo: columnas nuevas, vacias (nada cambia hasta que se configure un articulo).
alter table articulos add column if not exists unidad_proveedor text;
alter table articulos add column if not exists factor_proveedor numeric;
alter table marca_articulo add column if not exists unidad_proveedor text;
alter table marca_articulo add column if not exists factor_proveedor numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'articulos_factor_proveedor_positivo') then
    alter table articulos add constraint articulos_factor_proveedor_positivo check (factor_proveedor is null or factor_proveedor > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marca_articulo_factor_proveedor_positivo') then
    alter table marca_articulo add constraint marca_articulo_factor_proveedor_positivo check (factor_proveedor is null or factor_proveedor > 0);
  end if;
end $$;
