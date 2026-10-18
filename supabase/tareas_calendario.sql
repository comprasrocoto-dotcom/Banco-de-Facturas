-- ============================================================
--  TAREAS EN CALENDARIO: asignar varias fechas de una vez (18/10/2026, pedido del usuario)
-- ============================================================
-- Desde el calendario del menu «📝 Tareas» el administrador marca varios dias del mes (ej. inventario ciclico todos los lunes)
-- y a cada persona elegida le queda UNA tarea por dia. Le llega UN SOLO correo por persona con la lista de fechas (igual de
-- formato que el de tarea_crear), para no mandarle un correo por dia.
-- Solo aditivo: una funcion nueva. No cambia tablas, ni tarea_crear, ni nada de lo que ya funciona.
-- Se puede correr varias veces (create or replace).
create or replace function tarea_crear_varias(p_asignados uuid[], p_tipo text, p_titulo text, p_descripcion text, p_sede int, p_fechas date[], p_usuario text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare u uuid; f date; v_id bigint; n int := 0; v_dest text; v_nombre text; v_fechas date[]; v_lista text; v_cant int;
        v_tipo text := case p_tipo when 'inventario' then '📦 Inventario cíclico' when 'visita' then '🚗 Visita' when 'capacitacion' then '🎓 Capacitación' else '📝 Tarea' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador asigna tareas.' using errcode = '42501'; end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'Escribe el título de la tarea.' using errcode = '22023'; end if;
  if coalesce(cardinality(p_asignados), 0) = 0 then raise exception 'Elige a quién se le asigna.' using errcode = '22023'; end if;
  -- fechas sin repetir y en orden
  select array_agg(distinct x order by x) into v_fechas from unnest(p_fechas) as x where x is not null;
  v_cant := coalesce(cardinality(v_fechas), 0);
  if v_cant = 0 then raise exception 'Marca al menos un día en el calendario.' using errcode = '22023'; end if;
  if v_cant > 62 then raise exception 'Máximo 62 días por asignación.' using errcode = '22023'; end if;
  v_lista := (select string_agg('   • ' || to_char(x, 'DD/MM/YYYY') || ' (' ||
                 (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from x)::int + 1] || ')', E'\n' order by x)
              from unnest(v_fechas) as x);

  foreach u in array p_asignados loop
    select nombre into v_nombre from perfiles where user_id = u and rol in ('admin', 'pagos') and coalesce(activo, true);
    if v_nombre is null then continue; end if;
    foreach f in array v_fechas loop
      insert into tarea (asignada_a, tipo, titulo, descripcion, sede_id, fecha_limite)
      values (u, coalesce(nullif(p_tipo, ''), 'otra'), btrim(p_titulo), nullif(btrim(coalesce(p_descripcion, '')), ''), p_sede, f)
      returning id into v_id;
      insert into tarea_evento (tarea_id, usuario_nombre, estado, comentario) values (v_id, nullif(btrim(coalesce(p_usuario, '')), ''), 'pendiente', 'Tarea asignada (calendario)');
      n := n + 1;
    end loop;
    select coalesce(nullif(btrim(p.correo_avisos), ''), au.email::text) into v_dest from perfiles p left join auth.users au on au.id = p.user_id where p.user_id = u;
    if v_dest is not null then
      perform correo_encolar(v_dest,
        '📝 Banco de Facturas · ' || v_nombre || ' · ' ||
          case when v_cant = 1 then 'nueva tarea: ' || btrim(p_titulo) || ' · vence ' || to_char(v_fechas[1], 'DD/MM')
               else v_cant || ' tareas nuevas: ' || btrim(p_titulo) || ' · del ' || to_char(v_fechas[1], 'DD/MM') || ' al ' || to_char(v_fechas[v_cant], 'DD/MM') end,
        '👋 Hola ' || v_nombre || E',\n\nTe asignaron ' || case when v_cant = 1 then 'una tarea' else v_cant || ' tareas' end || E' en el Banco de Facturas:\n\n' ||
        v_tipo || ': ' || btrim(p_titulo) ||
        coalesce(E'\n🏪 Sede: ' || (select nombre from sedes where id = p_sede), '') ||
        E'\n📅 ' || case when v_cant = 1 then 'Fecha de cumplimiento:' else 'Fechas de cumplimiento (una tarea por día):' end || E'\n' || v_lista ||
        coalesce(E'\n\n' || nullif(btrim(coalesce(p_descripcion, '')), ''), '') ||
        E'\n\n👉 Entra a la web, menú «📝 Tareas» (puedes verlas en el 📅 Calendario): cambia el estado cuando la empieces y cuando la termines, y sube las evidencias (fotos o PDF).' ||
        E'\n\n🤖 Correo automático del Banco de Facturas.',
        null, null, null, null, 'comprasrocoto@gmail.com');
    end if;
  end loop;
  if n = 0 then raise exception 'Ninguna de las personas elegidas puede recibir tareas.' using errcode = '22023'; end if;
  return n;
end $$;

revoke all on function tarea_crear_varias(uuid[], text, text, text, int, date[], text) from public, anon;
grant execute on function tarea_crear_varias(uuid[], text, text, text, int, date[], text) to authenticated, service_role;

-- ------------------------------------------------------------
-- PRUEBA SEGURA (se revierte sola): correr este bloque en el editor SQL de Supabase ANTES de aplicar de verdad.
-- Crea 2 tareas de prueba para el primer administrador activo y luego deshace todo (no queda nada ni sale correo).
-- ------------------------------------------------------------
-- begin;
--   select tarea_crear_varias(array[(select user_id from perfiles where rol = 'admin' and coalesce(activo, true) limit 1)],
--          'inventario', 'PRUEBA calendario', 'no es real', null, array['2026-11-02'::date, '2026-11-09'::date], 'prueba');
--   select id, titulo, fecha_limite, estado from tarea where titulo = 'PRUEBA calendario';
--   select asunto, left(cuerpo, 400) from correo_cola where asunto like '%PRUEBA calendario%';
-- rollback;
