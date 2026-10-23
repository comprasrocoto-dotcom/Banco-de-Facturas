-- ============================================================
--  INGRESOS AUTOMATICOS DEL AGENTE (23/10/2026, pedido del usuario)
-- ============================================================
-- «Si mantengo abierto el agente, que tome solo los documentos pendientes por ingresar, que no dependa de que yo lo lance;
--  y si lo lanzo y las sedes dejan listos mas documentos, que los tome.»
-- perfiles.agente_auto: el PC de esa persona (perfiles.pc_agente) lanza SOLO una orden de ingresos a su nombre cuando hay
-- documentos NUEVOS listos (factura amarrada, sin N° de ingreso, nunca procesados) dentro de sus sedes.
-- ingreso_listos(p_host): para el vigilante. Devuelve el dueño de ese PC y los pedidos listos (vacio si el PC no tiene dueño con
-- agente_auto). No cambia nada: solo lee. La orden la crea el vigilante (una sola orden de ingresos activa: indice ux_ordenes_ingresos_activa).
-- Solo aditivo: una columna nueva y una funcion nueva.

alter table perfiles add column if not exists agente_auto boolean not null default false;

create or replace function public.ingreso_listos(p_host text)
returns table(usuario uuid, pedido_id bigint, numero text)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_user uuid; v_alc jsonb; v_restr boolean; v_sedes int[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente' using errcode = '42501'; end if;
  select pf.user_id into v_user from perfiles pf
   where upper(btrim(coalesce(pf.pc_agente, ''))) = upper(btrim(coalesce(p_host, ''))) and pf.agente_auto and coalesce(pf.activo, true)
   limit 1;
  if v_user is null then return; end if;
  v_alc := alcance_de(v_user);
  v_restr := coalesce((v_alc ->> 'restringido')::boolean, false);
  select coalesce(array_agg(x::int), '{}') into v_sedes from jsonb_array_elements_text(coalesce(v_alc -> 'sedes', '[]'::jsonb)) x;
  return query
    select v_user, p.id, p.numero from pedidos p
      join facturas f on f.cufe = p.factura_cufe
     where p.factura_cufe is not null
       and coalesce(btrim(p.pedido_erp), '') = ''
       and coalesce(p.estado, '') <> 'facturado'
       and coalesce(btrim(f.num_ingreso), '') = ''
       and (not v_restr or p.sede_id is null or p.sede_id = any(v_sedes))
       and not exists (select 1 from ingreso_documento d where d.pedido_id = p.id and d.estado <> 'PENDIENTE')
     order by p.id;
end $function$;

revoke all on function public.ingreso_listos(text) from public, anon, authenticated;
grant execute on function public.ingreso_listos(text) to service_role;

-- el PC de Mariluz toma solo los documentos listos
update perfiles set agente_auto = true where user_id = 'b31d3fa1-3054-40cf-985d-9afdac2af0a0';

notify pgrst, 'reload schema';
