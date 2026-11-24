-- ============================================================
-- SACAR DE LA COLA DOCUMENTOS QUE EL AGENTE TIENE «TOMADOS»  (24/11/2026)
--   Pedido del usuario: «no me deja borrar algunos pedidos, este lo ingrese manual pero no me da la opcion de borrar» /
--   «no se deja quitar de la cola con errores». Al arrancar una corrida, el agente toma los documentos (PROCESANDO/«REINTENTANDO»)
--   y ingreso_descartar() solo saca los que estan en ERROR o PENDIENTE_REINTENTO. Esta funcion NUEVA (no cambia la anterior)
--   saca tambien los tomados, MENOS el que el agente esta trabajando en este momento (progreso.actual de la corrida en curso).
--   Si el agente igual llega a uno de ellos en la misma corrida, su validacion «YA_EXISTE» evita duplicarlo en el ERP.
-- ============================================================
create or replace function ingreso_descartar_tomados(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $f$
declare v_n int; v_quien text; v_actual text;
begin
  if not tiene_permiso('ingresos.iniciar') then raise exception 'sin permiso para sacar documentos de la cola' using errcode = '42501'; end if;
  select nombre into v_quien from perfiles where user_id = auth.uid();
  select string_agg(o.progreso->'actual'->>'pedido', ',') into v_actual from ordenes o where o.estado = 'corriendo';
  update ingreso_documento d
     set estado = 'DESCARTADO', etapa = 'sacado de la cola por ' || coalesce(v_quien, 'el usuario') || ' (no se reintenta)',
         actualizado_en = now(), terminado_en = now()
   where d.pedido_id = any (coalesce(p_ids, '{}'))
     and d.estado in ('ERROR', 'PENDIENTE_REINTENTO', 'PROCESANDO', 'PEDIDO_CREADO', 'FACTURANDO')
     and not (coalesce(d.numero, '') <> '' and coalesce(d.numero, '') = any (string_to_array(coalesce(v_actual, ''), ',')))
     and (not analista_restringido() or not pedido_de_otra_sede(d.pedido_id));
  get diagnostics v_n = row_count; return v_n;
end $f$;
revoke all on function ingreso_descartar_tomados(bigint[]) from public, anon;
grant execute on function ingreso_descartar_tomados(bigint[]) to authenticated;
