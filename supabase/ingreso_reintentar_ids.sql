-- ============================================================
--  REINTENTAR SOLO ALGUNOS DOCUMENTOS (25/10/2026, pedido del usuario)
-- ============================================================
-- «Darme la opcion de lanzar una sola sede/marca o solo el pedido que yo quiera.» Si lo elegido estaba en ERROR (o sacado de la
-- cola), vuelve a la cola SOLO eso (no todos los errores como «Reintentar errores»). Misma regla de permisos que ingreso_reintentar_errores.
-- Solo aditivo: una funcion nueva.

create or replace function public.ingreso_reintentar_ids(p_ids bigint[])
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_n int; v_quien text;
begin
  if not tiene_permiso('ingresos.iniciar') then raise exception 'sin permiso para reintentar' using errcode = '42501'; end if;
  select nombre into v_quien from perfiles where user_id = auth.uid();
  update ingreso_documento d
     set estado = 'PENDIENTE_REINTENTO', etapa = 'reintento elegido por ' || coalesce(v_quien, 'el usuario'),
         error = null, error_etapa = null, actualizado_en = now(), terminado_en = null
   where d.pedido_id = any (coalesce(p_ids, '{}'))
     and d.estado in ('ERROR', 'DESCARTADO')
     and (not analista_restringido() or not pedido_de_otra_sede(d.pedido_id));
  get diagnostics v_n = row_count; return v_n;
end $function$;

revoke all on function public.ingreso_reintentar_ids(bigint[]) from public, anon;
grant execute on function public.ingreso_reintentar_ids(bigint[]) to authenticated, service_role;

notify pgrst, 'reload schema';
