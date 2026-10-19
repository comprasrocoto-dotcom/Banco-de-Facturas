-- ============================================================
--  TAREAS CON FECHA DE INICIO Y FECHA DE FIN (18/10/2026, pedido del usuario)
-- ============================================================
-- Al asignar se elige cuando empieza y cuando debe estar terminada. fecha_limite sigue siendo el FIN (la evaluacion «a tiempo»
-- no cambia); la columna nueva fecha_inicio guarda el inicio (vacia en las tareas que ya existen: no se tocan).
-- Solo aditivo: una columna nueva y dos funciones nuevas (tarea_asignar_rango, tarea_fechas). No cambia tarea_asignar,
-- tarea_crear, tarea_crear_varias ni tarea_editar. Se puede correr varias veces.

alter table tarea add column if not exists fecha_inicio date;

-- igual que tarea_asignar (supabase/tareas_plantillas.sql) + p_dias_antes: cada fecha es el FIN y el inicio es esos dias antes.
create or replace function tarea_asignar_rango(p_asignados uuid[], p_tipo text, p_titulo text, p_descripcion text, p_sede int, p_fechas date[],
                                               p_actividades jsonb default null, p_usuario text default null, p_dias_antes int default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare u uuid; f date; v_id bigint; n int := 0; v_dest text; v_nombre text; v_fechas date[]; v_lista text; v_cant int; v_d int := greatest(coalesce(p_dias_antes, 0), 0);
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
  if v_d > 365 then raise exception 'El rango entre inicio y fin es muy largo (máximo 365 días).' using errcode = '22023'; end if;
  -- cada fecha de p_fechas es el FIN; el inicio es v_d dias antes (0 = el mismo dia)
  v_lista := (select string_agg('   • ' || case when v_d > 0 then 'del ' || to_char(x - v_d, 'DD/MM/YYYY') || ' (' ||
                 (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from x - v_d)::int + 1] || ') al ' else '' end ||
                 to_char(x, 'DD/MM/YYYY') || ' (' ||
                 (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from x)::int + 1] || ')', E'\n' order by x)
              from unnest(v_fechas) as x);
  v_acts_txt := (select string_agg('   ☐ ' || (a->>'t'), E'\n' order by o) from jsonb_array_elements(coalesce(v_acts, '[]'::jsonb)) with ordinality as e(a, o));

  foreach u in array p_asignados loop
    select nombre into v_nombre from perfiles where user_id = u and rol in ('admin', 'pagos') and coalesce(activo, true);
    if v_nombre is null then continue; end if;
    foreach f in array v_fechas loop
      insert into tarea (asignada_a, tipo, titulo, descripcion, sede_id, fecha_inicio, fecha_limite, actividades)
      values (u, coalesce(nullif(p_tipo, ''), 'otra'), btrim(p_titulo), nullif(btrim(coalesce(p_descripcion, '')), ''), p_sede, f - v_d, f, v_acts)
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
        E'\n📅 ' || case when v_cant = 1 then case when v_d > 0 then 'Fechas (inicio y fin):' else 'Fecha de cumplimiento:' end
                         else case when v_d > 0 then 'Fechas de inicio y fin (una tarea por cada rango):' else 'Fechas de cumplimiento (una tarea por día):' end end || E'\n' || v_lista ||
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

-- cambiar inicio y fin de UNA tarea (solo administrador)
create or replace function tarea_fechas(p_id bigint, p_inicio date, p_fin date, p_usuario text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador cambia las fechas.' using errcode = '42501'; end if;
  if p_fin is null then raise exception 'Falta la fecha de fin.' using errcode = '22023'; end if;
  if p_inicio is not null and p_inicio > p_fin then raise exception 'La fecha de inicio no puede ser después de la fecha de fin.' using errcode = '22023'; end if;
  if not exists (select 1 from tarea where id = p_id) then raise exception 'Esa tarea no existe.' using errcode = '22023'; end if;
  update tarea set fecha_inicio = p_inicio, fecha_limite = p_fin, actualizado_en = now() where id = p_id;
  insert into tarea_evento (tarea_id, usuario_nombre, comentario)
  values (p_id, nullif(btrim(coalesce(p_usuario, '')), ''), 'Fechas cambiadas: ' || case when p_inicio is not null and p_inicio < p_fin
          then 'del ' || to_char(p_inicio, 'DD/MM/YYYY') || ' al ' else 'vence ' end || to_char(p_fin, 'DD/MM/YYYY'));
end $$;

revoke all on function tarea_asignar_rango(uuid[], text, text, text, int, date[], jsonb, text, int), tarea_fechas(bigint, date, date, text) from public, anon;
grant execute on function tarea_asignar_rango(uuid[], text, text, text, int, date[], jsonb, text, int), tarea_fechas(bigint, date, date, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- PRUEBA SEGURA (se revierte sola): pegar TODO este archivo y, al final, este bloque sin los «--».
-- ------------------------------------------------------------
-- do $$
-- declare n int; adm uuid; tid bigint; ini date; fin date; cuerpo text;
-- begin
--   perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   perform set_config('request.jwt.claim.role', 'service_role', true);
--   select user_id into adm from perfiles where rol = 'admin' and coalesce(activo, true) limit 1;
--   n := tarea_asignar_rango(array[adm], 'inventario', 'PRUEBA rango', null, null, array['2026-11-04'::date, '2026-11-11'::date], null, 'prueba', 2);
--   select id, fecha_inicio, fecha_limite into tid, ini, fin from tarea where titulo = 'PRUEBA rango' order by fecha_limite limit 1;
--   select c.cuerpo into cuerpo from correo_cola c where c.asunto like '%PRUEBA rango%';
--   perform tarea_fechas(tid, '2026-11-01', '2026-11-05', 'prueba');
--   raise exception 'RESULTADO creadas=% primera=% a % | despues=% | correo=%', n, ini, fin,
--     (select fecha_inicio || ' a ' || fecha_limite from tarea where id = tid), substring(cuerpo from '• [^\n]*');
-- end $$;
