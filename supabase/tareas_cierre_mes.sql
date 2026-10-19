-- ============================================================
--  TAREA POR DEFECTO «CIERRE DE MES (TOKEN DIAN)» (19/10/2026, pedido del usuario)
-- ============================================================
-- Subir el token a la DIAN; al cerrar el mes el Banco de Facturas debe quedar sin facturas «Sin asignar» y todo conciliado.
-- La plantilla (resumen y actividades) vive en js/tareas.js. Aqui solo:
--   1. se agrega 'cierre_mes' a la lista de tipos permitidos (la lista anterior queda igual: no se quita nada);
--   2. el nombre bonito del tipo para los correos.
-- No toca ninguna tarea existente. Se puede correr varias veces.

alter table tarea drop constraint if exists tarea_tipo_check;
alter table tarea add constraint tarea_tipo_check
  check (tipo in ('inventario', 'inventario_general', 'auditoria', 'cierre_mes', 'capacitacion', 'visita', 'otra'));

create or replace function tarea_tipo_nombre(p_tipo text) returns text language sql immutable as $$
  select case p_tipo when 'inventario' then '📦 Inventario cíclico' when 'inventario_general' then '🗃️ Inventario general'
                     when 'auditoria' then '🔍 Auditoría de punto de venta' when 'cierre_mes' then '🗓️ Token DIAN diario y cierre de mes'
                     when 'visita' then '🚗 Visita' when 'capacitacion' then '🎓 Capacitación' else '📝 Tarea' end
$$;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- PRUEBA SEGURA (se revierte sola): pegar TODO este archivo y, al final, este bloque sin los «--».
-- ------------------------------------------------------------
-- do $$
-- declare n int; adm uuid; tipo text; asunto text;
-- begin
--   perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   perform set_config('request.jwt.claim.role', 'service_role', true);
--   select user_id into adm from perfiles where rol = 'admin' and coalesce(activo, true) limit 1;
--   n := tarea_asignar_rango(array[adm], 'cierre_mes', 'PRUEBA cierre', null, null, array['2026-10-31'::date], '[{"t":"Subir token"}]'::jsonb, 'prueba', 2);
--   select t.tipo into tipo from tarea t where t.titulo = 'PRUEBA cierre' limit 1;
--   select c.cuerpo into asunto from correo_cola c where c.asunto like '%PRUEBA cierre%';
--   raise exception 'RESULTADO creadas=% tipo=% correo=% | total tareas=%', n, tipo, substring(asunto from 'Token DIAN[^:]*'), (select count(*) from tarea);
-- end $$;
