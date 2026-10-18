-- ============================================================
--  TAREAS CON PLANTILLA: resumen + lista de actividades (18/10/2026, pedido del usuario)
-- ============================================================
-- Al elegir el tipo de tarea (Inventario cíclico, Inventario general, Auditoría de punto de venta, Capacitación…) la web carga
-- su resumen y sus actividades (las plantillas viven en js/tareas.js). Se pueden editar antes de asignar y despues, solo en esa
-- tarea. El analista marca cada actividad como hecha (lista de verificacion).
-- Solo aditivo:
--   * columna nueva tarea.actividades (jsonb, vacia en las tareas que ya existen: no se tocan),
--   * la lista de tipos permitidos se AMPLIA con 'inventario_general' y 'auditoria' (los de antes siguen valiendo),
--   * funciones nuevas tarea_asignar, tarea_actividad y tarea_actividades_editar.
-- No cambia tarea_crear, tarea_crear_varias, tarea_estado, tarea_evidencia ni tarea_editar. Se puede correr varias veces.

alter table tarea add column if not exists actividades jsonb;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.tarea'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%tipo%' loop
    execute format('alter table tarea drop constraint %I', c);
  end loop;
end $$;
alter table tarea add constraint tarea_tipo_check
  check (tipo in ('inventario', 'inventario_general', 'auditoria', 'capacitacion', 'visita', 'otra'));

-- nombre bonito del tipo (para los correos)
create or replace function tarea_tipo_nombre(p_tipo text) returns text language sql immutable as $$
  select case p_tipo when 'inventario' then '📦 Inventario cíclico' when 'inventario_general' then '🗃️ Inventario general'
                     when 'auditoria' then '🔍 Auditoría de punto de venta' when 'visita' then '🚗 Visita'
                     when 'capacitacion' then '🎓 Capacitación' else '📝 Tarea' end
$$;

-- lista de actividades limpia: [{t, h}] (max 60, sin vacias). p_conservar = respeta h/por/en que vengan marcadas.
create or replace function tarea_actividades_limpiar(p_actividades jsonb, p_conservar boolean default false) returns jsonb
language sql immutable as $$
  select nullif(coalesce((
    select jsonb_agg(
             jsonb_build_object('t', left(btrim(x.txt), 300), 'h', p_conservar and x.h)
             || case when p_conservar and x.h then jsonb_strip_nulls(jsonb_build_object('por', x.por, 'en', x.en)) else '{}'::jsonb end
             order by x.o)
      from (select coalesce(e.v->>'t', case when jsonb_typeof(e.v) = 'string' then e.v #>> '{}' end) as txt,
                   coalesce(e.v->'h' = 'true'::jsonb, false) as h, e.v->'por' as por, e.v->'en' as en, e.o
              from jsonb_array_elements(case when jsonb_typeof(p_actividades) = 'array' then p_actividades else '[]'::jsonb end)
                   with ordinality as e(v, o)) x
     where coalesce(btrim(x.txt), '') <> '' and x.o <= 60), '[]'::jsonb), '[]'::jsonb)
$$;

-- asignar (una o varias fechas, una o varias personas) con resumen y actividades. Solo administrador.
-- Una tarea por persona y por fecha; UN correo por persona (con las fechas y las actividades). -> cuantas tareas se crearon
create or replace function tarea_asignar(p_asignados uuid[], p_tipo text, p_titulo text, p_descripcion text, p_sede int, p_fechas date[],
                                         p_actividades jsonb default null, p_usuario text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare u uuid; f date; v_id bigint; n int := 0; v_dest text; v_nombre text; v_fechas date[]; v_lista text; v_cant int;
        v_acts jsonb := tarea_actividades_limpiar(p_actividades, false); v_acts_txt text;
        v_tipo text := tarea_tipo_nombre(p_tipo);
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador asigna tareas.' using errcode = '42501'; end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'Escribe el título de la tarea.' using errcode = '22023'; end if;
  if coalesce(cardinality(p_asignados), 0) = 0 then raise exception 'Elige a quién se le asigna.' using errcode = '22023'; end if;
  select array_agg(distinct x order by x) into v_fechas from unnest(p_fechas) as x where x is not null;
  v_cant := coalesce(cardinality(v_fechas), 0);
  if v_cant = 0 then raise exception 'Elige la fecha de cumplimiento.' using errcode = '22023'; end if;
  if v_cant > 62 then raise exception 'Máximo 62 días por asignación.' using errcode = '22023'; end if;
  v_lista := (select string_agg('   • ' || to_char(x, 'DD/MM/YYYY') || ' (' ||
                 (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from x)::int + 1] || ')', E'\n' order by x)
              from unnest(v_fechas) as x);
  v_acts_txt := (select string_agg('   ☐ ' || (a->>'t'), E'\n' order by o) from jsonb_array_elements(coalesce(v_acts, '[]'::jsonb)) with ordinality as e(a, o));

  foreach u in array p_asignados loop
    select nombre into v_nombre from perfiles where user_id = u and rol in ('admin', 'pagos') and coalesce(activo, true);
    if v_nombre is null then continue; end if;
    foreach f in array v_fechas loop
      insert into tarea (asignada_a, tipo, titulo, descripcion, sede_id, fecha_limite, actividades)
      values (u, coalesce(nullif(p_tipo, ''), 'otra'), btrim(p_titulo), nullif(btrim(coalesce(p_descripcion, '')), ''), p_sede, f, v_acts)
      returning id into v_id;
      insert into tarea_evento (tarea_id, usuario_nombre, estado, comentario)
      values (v_id, nullif(btrim(coalesce(p_usuario, '')), ''), 'pendiente', case when v_cant = 1 then 'Tarea asignada' else 'Tarea asignada (calendario)' end);
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
        coalesce(E'\n🏪 Sede: ' || (select s.nombre || coalesce(' · ' || m.nombre, '') from sedes s left join marcas m on m.id = s.marca_id where s.id = p_sede), '') ||
        E'\n📅 ' || case when v_cant = 1 then 'Fecha de cumplimiento:' else 'Fechas de cumplimiento (una tarea por día):' end || E'\n' || v_lista ||
        coalesce(E'\n\n📋 Resumen:\n' || nullif(btrim(coalesce(p_descripcion, '')), ''), '') ||
        coalesce(E'\n\n✅ Actividades (márcalas en la web a medida que las hagas):\n' || v_acts_txt, '') ||
        E'\n\n👉 Entra a la web, menú «📝 Tareas»: cambia el estado cuando la empieces y cuando la termines, marca las actividades y sube las evidencias (fotos o PDF).' ||
        E'\n\n🤖 Correo automático del Banco de Facturas.',
        null, null, null, null, 'comprasrocoto@gmail.com');
    end if;
  end loop;
  if n = 0 then raise exception 'Ninguna de las personas elegidas puede recibir tareas.' using errcode = '22023'; end if;
  return n;
end $$;

-- marcar / desmarcar UNA actividad (la persona asignada o el administrador). p_texto = el texto que se vio en pantalla (si la
-- lista cambio mientras tanto, no marca otra por error). -> la lista actualizada
create or replace function tarea_actividad(p_id bigint, p_idx int, p_texto text, p_hecha boolean, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tarea%rowtype; v_item jsonb; v_nueva jsonb;
begin
  select * into t from tarea where id = p_id for update;
  if not found then raise exception 'Esa tarea no existe.' using errcode = '22023'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' and t.asignada_a is distinct from auth.uid() then raise exception 'Esa tarea no es tuya.' using errcode = '42501'; end if;
  if t.estado = 'cancelada' then raise exception 'La tarea está cancelada.' using errcode = '22023'; end if;
  if jsonb_typeof(t.actividades) is distinct from 'array' or p_idx is null or p_idx < 0 or p_idx >= jsonb_array_length(t.actividades) then
    raise exception 'Esa actividad no existe. Recarga la página.' using errcode = '22023'; end if;
  v_item := t.actividades -> p_idx;
  if p_texto is not null and (v_item->>'t') is distinct from p_texto then raise exception 'La lista de actividades cambió. Recarga la página.' using errcode = '22023'; end if;
  v_item := case when coalesce(p_hecha, false)
                 then (v_item - 'por' - 'en') || jsonb_strip_nulls(jsonb_build_object('h', true, 'por', nullif(btrim(coalesce(p_usuario, '')), ''), 'en', now()))
                 else (v_item - 'por' - 'en') || jsonb_build_object('h', false) end;
  v_nueva := jsonb_set(t.actividades, array[p_idx::text], v_item);
  update tarea set actividades = v_nueva, actualizado_en = now() where id = p_id;
  return v_nueva;
end $$;

-- editar el resumen y las actividades de UNA tarea ya asignada (solo administrador; la plantilla no cambia).
create or replace function tarea_actividades_editar(p_id bigint, p_descripcion text, p_actividades jsonb, p_usuario text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador edita tareas.' using errcode = '42501'; end if;
  if not exists (select 1 from tarea where id = p_id) then raise exception 'Esa tarea no existe.' using errcode = '22023'; end if;
  update tarea set descripcion = nullif(btrim(coalesce(p_descripcion, '')), ''), actividades = tarea_actividades_limpiar(p_actividades, true), actualizado_en = now()
   where id = p_id;
  insert into tarea_evento (tarea_id, usuario_nombre, comentario) values (p_id, nullif(btrim(coalesce(p_usuario, '')), ''), 'Resumen y actividades editados');
end $$;

revoke all on function tarea_asignar(uuid[], text, text, text, int, date[], jsonb, text), tarea_actividad(bigint, int, text, boolean, text),
                       tarea_actividades_editar(bigint, text, jsonb, text) from public, anon;
grant execute on function tarea_asignar(uuid[], text, text, text, int, date[], jsonb, text), tarea_actividad(bigint, int, text, boolean, text),
                          tarea_actividades_editar(bigint, text, jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- PRUEBA SEGURA (se revierte sola): pegar TODO este archivo y, al final, este bloque sin los «--». Termina con un error
-- «RESULTADO …» a proposito, y por eso no queda nada (ni columna, ni funciones, ni tareas, ni correos).
-- ------------------------------------------------------------
-- do $$
-- declare n int; adm uuid; tid bigint; l jsonb; k int;
-- begin
--   perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   perform set_config('request.jwt.claim.role', 'service_role', true);
--   select user_id into adm from perfiles where rol = 'admin' and coalesce(activo, true) limit 1;
--   n := tarea_asignar(array[adm], 'auditoria', 'PRUEBA plantilla', 'resumen de prueba', null, array['2026-11-02'::date],
--                      '[{"t":"Uno"},{"t":"Dos"},{"t":""}]'::jsonb, 'prueba');
--   select id into tid from tarea where titulo = 'PRUEBA plantilla';
--   l := tarea_actividad(tid, 1, 'Dos', true, 'prueba');
--   perform tarea_actividades_editar(tid, 'resumen editado', l || '[{"t":"Tres"}]'::jsonb, 'prueba');
--   select actividades into l from tarea where id = tid;
--   select count(*) into k from correo_cola where asunto like '%PRUEBA plantilla%';
--   raise exception 'RESULTADO creadas=% actividades=% marcada=% correos=%', n, jsonb_array_length(l), l->1->>'h', k;
-- end $$;
