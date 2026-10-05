-- ============================================================
--  SACAR DOCUMENTOS DE LA COLA DE INGRESOS ("Limpiar" en "Documentos con novedad")  -  05/10/2026
--  Pedido del usuario: despues de revisar las novedades de una corrida, poder limpiar la ventana. Decidio que
--  "limpiar" = SACARLOS DE LA COLA: el agente deja de reintentarlos (p. ej. PED-0101/0167/0190/0193, que se
--  reintentaban en cada corrida desde septiembre). Estado nuevo DESCARTADO:
--   - ingreso_tomar() solo toma PENDIENTE/PENDIENTE_REINTENTO (o en proceso vencido): un DESCARTADO nunca se
--     vuelve a tomar, ni siquiera por un agente con codigo viejo en el PC de un analista.
--   - ingreso_reintentar_errores() solo mueve ERROR -> no lo resucita.
--   - el panel de la web solo lista ERROR/PENDIENTE_REINTENTO -> desaparece de la ventana.
--  Solo se descartan documentos en ERROR o PENDIENTE_REINTENTO (nunca uno en proceso ni COMPLETADO), con el
--  mismo permiso y el mismo alcance por sede que "Reintentar errores".
-- ============================================================
alter table ingreso_documento drop constraint if exists ingreso_documento_estado_check;
alter table ingreso_documento add constraint ingreso_documento_estado_check
  check (estado in ('PENDIENTE', 'PROCESANDO', 'PEDIDO_CREADO', 'FACTURANDO', 'COMPLETADO', 'ERROR', 'PENDIENTE_REINTENTO', 'DESCARTADO'));

create or replace function ingreso_descartar(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $fn$
declare v_n int; v_quien text;
begin
  if not tiene_permiso('ingresos.iniciar') then raise exception 'sin permiso para sacar documentos de la cola' using errcode = '42501'; end if;
  select nombre into v_quien from perfiles where user_id = auth.uid();
  update ingreso_documento d
     set estado = 'DESCARTADO', etapa = 'sacado de la cola por ' || coalesce(v_quien, 'el usuario') || ' (no se reintenta)',
         actualizado_en = now(), terminado_en = now()
   where d.pedido_id = any (coalesce(p_ids, '{}'))
     and d.estado in ('ERROR', 'PENDIENTE_REINTENTO')
     and (not analista_restringido() or not pedido_de_otra_sede(d.pedido_id));
  get diagnostics v_n = row_count; return v_n;
end
$fn$;
revoke all on function ingreso_descartar(bigint[]) from public, anon;
grant execute on function ingreso_descartar(bigint[]) to authenticated;
