-- la sede puede soltar la factura (volverla al pool) y re-tomarla
drop policy if exists fact_tomar on facturas;
create policy fact_tomar on facturas for update to authenticated
  using (mi_rol() = 'sede' and (sede_id = mi_sede() or (estado = 'pool' and marca_id = mi_marca())))
  with check (mi_rol() = 'sede' and (sede_id = mi_sede() or (estado = 'pool' and marca_id = mi_marca())));
