-- ============================================================
--  VOLVER A LA COLA un documento que se saco de la cola (DESCARTADO)  -  05/10/2026
--  Caso real: PED-0237 y PED-0246 se sacaron con "Limpiar ventana"; luego se quiso ingresarlos con "Iniciar ingresos" y el
--  agente no los tomaba (bien: respeta el DESCARTADO), pero la web los seguia listando. Ahora "Iniciar ingresos" pregunta si
--  se vuelven a poner en la cola y usa esta funcion. Lo inverso de ingreso_descartar(): mismo permiso y mismo alcance por sede.
--  Solo DESCARTADO -> PENDIENTE (nunca toca uno en proceso ni COMPLETADO). Las salvaguardas del agente siguen igual
--  (p. ej. si ya existe una factura con ese Su Doc en el ERP, no crea otra).
-- ============================================================
create or replace function ingreso_reencolar(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $fn$
declare v_n int; v_quien text;
begin
  if not tiene_permiso('ingresos.iniciar') then raise exception 'sin permiso para volver documentos a la cola' using errcode = '42501'; end if;
  select nombre into v_quien from perfiles where user_id = auth.uid();
  update ingreso_documento d
     set estado = 'PENDIENTE', etapa = 'vuelto a la cola por ' || coalesce(v_quien, 'el usuario'),
         error = null, error_etapa = null, actualizado_en = now(), terminado_en = null
   where d.pedido_id = any (coalesce(p_ids, '{}'))
     and d.estado = 'DESCARTADO'
     and (not analista_restringido() or not pedido_de_otra_sede(d.pedido_id));
  get diagnostics v_n = row_count; return v_n;
end
$fn$;
revoke all on function ingreso_reencolar(bigint[]) from public, anon;
grant execute on function ingreso_reencolar(bigint[]) to authenticated;
