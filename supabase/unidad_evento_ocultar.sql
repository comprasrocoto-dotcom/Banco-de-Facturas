-- ============================================================
--  ADMIN > AGENTE > "DECISIONES RECIENTES DEL AGENTE": SACAR DE LA LISTA LO YA REVISADO  -  21/09/2026
--  Cada vez que el agente decide una unidad queda un evento 'decision_agente'. Al corregirla o confirmarla, el evento seguia apareciendo en la lista y
--  confundia. SOLO AGREGA: 2 columnas opcionales en unidad_evento (oculto_en, oculto_por) y 1 funcion para ocultar eventos. No borra ni cambia ninguna
--  decision, regla ni correccion: un evento oculto sigue en la base (auditoria), solo deja de mostrarse en la lista.
-- ============================================================
alter table unidad_evento add column if not exists oculto_en timestamptz;
alter table unidad_evento add column if not exists oculto_por text;

-- Oculta decisiones del agente (solo tipo 'decision_agente'). Solo admin / pagos (o el robot con la llave de servicio). Devuelve cuantas ocultó.
create or replace function unidad_evento_ocultar(p_ids bigint[], p_usuario text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare v_n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'sin permiso para ocultar decisiones del agente';
  end if;
  update unidad_evento set oculto_en = now(), oculto_por = coalesce(nullif(btrim(p_usuario), ''), 'admin')
   where id = any (coalesce(p_ids, '{}')) and tipo = 'decision_agente' and oculto_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;
revoke all on function unidad_evento_ocultar(bigint[], text) from public, anon;
grant execute on function unidad_evento_ocultar(bigint[], text) to authenticated;

-- Lo que ya se corrigió o confirmó antes de hoy deja de aparecer: una decision del agente con una correccion/confirmacion POSTERIOR (o del mismo instante)
-- del mismo producto ya fue revisada.
update unidad_evento d set oculto_en = now(), oculto_por = 'auto: ya corregida o confirmada'
 where d.tipo = 'decision_agente' and d.oculto_en is null
   and exists (select 1 from unidad_evento c where c.clave = d.clave and c.tipo in ('correccion_usuario', 'confirmacion_admin') and c.creado_en >= d.creado_en);
