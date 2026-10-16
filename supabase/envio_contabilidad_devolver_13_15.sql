-- 16/10/2026: el arranque (lote 1) dio por enviado lo ingresado del 13 al 15/10, pero desde el lunes 12 no se envia nada.
-- Esos documentos vuelven a "Por enviar a contabilidad". Lo de antes del 13 sigue como enviado.
do $$
declare n int; v_antes int;
begin
  select count(*) into v_antes from contabilidad_envio where lote_id = 1;
  delete from contabilidad_envio e using facturas f
   where e.factura_cufe = f.cufe and e.lote_id = 1
     and f.fecha_ingreso is not null and f.fecha_ingreso::date between date '2026-10-13' and date '2026-10-15';
  get diagnostics n = row_count;
  update contabilidad_lote set cantidad = (select count(*) from contabilidad_envio where lote_id = 1),
         nota = coalesce(nota, '') || ' | 16/10: ' || n || ' ingresados del 13 al 15/10 volvieron a por enviar (no se habian enviado)'
   where id = 1;
  insert into historial (accion, detalle) values ('envio a contabilidad corregido', 'lote 1 (arranque): ' || n || ' documento(s) ingresados del 13 al 15/10 vuelven a por enviar');
  raise notice 'APLICADO antes=% devueltos=% quedan=%', v_antes, n, (select count(*) from contabilidad_envio where lote_id = 1);
end $$;
