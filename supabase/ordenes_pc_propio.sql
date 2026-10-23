-- ============================================================
--  ORDENES DEL AGENTE: QUIEN LA PIDE ELIGE EL PC (23/10/2026, pedido del usuario)
-- ============================================================
-- «Si lo lanzo yo, que se abra en mi PC y no en el de los auxiliares.»
-- Columna nueva perfiles.pc_agente (nombre del computador, ej. DESKTOP-Q554ADD). Si la persona que pide la orden tiene
-- pc_agente, SOLO ese computador la toma; si esta vacia, todo sigue como antes (cualquier PC permitido por el alcance).
-- Solo aditivo: una columna nueva y orden_tomar con UNA condicion mas. El agente no cambia (ya manda su nombre de PC).
-- Ojo: si ese PC esta apagado o sin vigilante, la orden queda «pendiente» hasta que se encienda.

alter table perfiles add column if not exists pc_agente text;

create or replace function public.orden_tomar(p_host text, p_analista uuid default null::uuid)
returns setof ordenes language plpgsql security definer set search_path to 'public' as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente' using errcode = '42501'; end if;
  return query update ordenes set estado = 'corriendo', tomada_en = now(), tomada_por = p_host, detener = false, progreso = null
    where id = (select o.id from ordenes o
                 where o.estado = 'pendiente'
                  and (p_analista is null or o.pedida_por is null or o.pedida_por = p_analista or not coalesce((alcance_de(o.pedida_por) ->> 'restringido')::boolean, false))
                  -- (23/10/2026) quien pidio la orden tiene su PC: solo ese computador la toma
                  and coalesce((select upper(btrim(pf.pc_agente)) = upper(btrim(coalesce(p_host, ''))) from perfiles pf
                                 where pf.user_id = o.pedida_por and nullif(btrim(coalesce(pf.pc_agente, '')), '') is not null), true)
                order by o.id limit 1 for update skip locked) returning *;
end $function$;

-- el PC de Mariluz (administradora)
update perfiles set pc_agente = 'DESKTOP-Q554ADD' where user_id = 'b31d3fa1-3054-40cf-985d-9afdac2af0a0';

notify pgrst, 'reload schema';
