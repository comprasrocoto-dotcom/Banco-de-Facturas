-- 16/10/2026 (pedido del usuario): los documentos ingresados del 13 al 15/10 que se devolvieron a "Por enviar" SI se habian
-- enviado. Vuelven al lote 1 (arranque) como enviados, con la misma fecha que tenian (dia de ingreso 11 p. m.) y con el mismo
-- criterio del arranque: terminados el mismo dia de su ingreso (o nota credito ingresada). Lo que ya este en otro lote no se toca.
do $$
declare n int;
begin
  insert into contabilidad_envio (factura_cufe, lote_id, enviada_en)
  select f.cufe, 1, (f.fecha_ingreso::date + time '23:00') at time zone 'America/Bogota'
    from facturas f
   where coalesce(btrim(f.num_ingreso), '') not in ('', 'null')
     and f.fecha_ingreso is not null and f.fecha_ingreso::date between date '2026-10-13' and date '2026-10-15'
     and (f.tipo::text = 'nota_credito'
          or (f.estado::text in ('sellada', 'pagada') and (f.sellada_en is null or (f.sellada_en at time zone 'America/Bogota')::date <= f.fecha_ingreso::date)))
  on conflict (factura_cufe) do nothing;
  get diagnostics n = row_count;
  update contabilidad_lote set cantidad = (select count(*) from contabilidad_envio where lote_id = 1),
         nota = coalesce(nota, '') || ' | 16/10: ' || n || ' ingresados del 13 al 15/10 volvieron a ENVIADOS (si se habian enviado)'
   where id = 1;
  insert into historial (accion, detalle) values ('envio a contabilidad corregido', 'lote 1 (arranque): ' || n || ' documento(s) ingresados del 13 al 15/10 vuelven a enviados (el usuario confirma que si se enviaron)');
  raise notice 'APLICADO: % documento(s) vuelven a enviados; lote 1 queda con %', n, (select count(*) from contabilidad_envio where lote_id = 1);
end $$;
