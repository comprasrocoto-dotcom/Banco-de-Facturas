-- ============================================================
--  TAREAS POR MARCA  (04/11/2026, pedido del usuario: «quiero montar tareas por marca o por sede, pero si la monto por
--  marca solo me llegue el correo de marca, no un correo individual por sede»)
-- ============================================================
-- Por SEDE sigue igual (una tarea por cada sede marcada). Por MARCA: UNA sola tarea para toda la marca (ej. «Ingreso de
-- facturas · Rocoto»), sin sede, y a cada persona le llega UN solo correo que dice la marca.
-- Solo aditivo: una columna nueva (tarea.marca_id, vacia en las tareas que ya existen) y una funcion nueva
-- (tarea_asignar_marca, igual a tarea_asignar_rango de supabase/tareas_fechas.sql pero con la marca). No cambia nada mas.
-- Se puede correr varias veces.

alter table tarea add column if not exists marca_id int references marcas(id) on delete set null;
create index if not exists tarea_marca_idx on tarea (marca_id) where marca_id is not null;

create or replace function tarea_asignar_marca(p_asignados uuid[], p_tipo text, p_titulo text, p_descripcion text, p_marca int, p_fechas date[],
                                               p_actividades jsonb default null, p_usuario text default null, p_dias_antes int default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare u uuid; f date; v_id bigint; n int := 0; v_dest text; v_nombre text; v_fechas date[]; v_lista text; v_cant int; v_d int := greatest(coalesce(p_dias_antes, 0), 0);
        v_acts jsonb := tarea_actividades_limpiar(p_actividades, false); v_acts_txt text;
        v_tipo text := tarea_tipo_nombre(p_tipo); v_marca text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador asigna tareas.' using errcode = '42501'; end if;
  select nombre into v_marca from marcas where id = p_marca;
  if v_marca is null then raise exception 'Elige la marca.' using errcode = '22023'; end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'Escribe el título de la tarea.' using errcode = '22023'; end if;
  if coalesce(cardinality(p_asignados), 0) = 0 then raise exception 'Elige a quién se le asigna.' using errcode = '22023'; end if;
  select array_agg(distinct x order by x) into v_fechas from unnest(p_fechas) as x where x is not null;
  v_cant := coalesce(cardinality(v_fechas), 0);
  if v_cant = 0 then raise exception 'Elige la fecha de cumplimiento.' using errcode = '22023'; end if;
  if v_cant > 62 then raise exception 'Máximo 62 días por asignación.' using errcode = '22023'; end if;
  if v_d > 365 then raise exception 'El rango entre inicio y fin es muy largo (máximo 365 días).' using errcode = '22023'; end if;
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
      insert into tarea (asignada_a, tipo, titulo, descripcion, sede_id, marca_id, fecha_inicio, fecha_limite, actividades)
      values (u, coalesce(nullif(p_tipo, ''), 'otra'), btrim(p_titulo), nullif(btrim(coalesce(p_descripcion, '')), ''), null, p_marca, f - v_d, f, v_acts)
      returning id into v_id;
      insert into tarea_evento (tarea_id, usuario_nombre, estado, comentario)
      values (v_id, nullif(btrim(coalesce(p_usuario, '')), ''), 'pendiente', 'Tarea asignada a toda la marca ' || v_marca);
      n := n + 1;
    end loop;
    -- UN solo correo por persona (con todas las fechas), no uno por sede
    select coalesce(nullif(btrim(p.correo_avisos), ''), au.email::text) into v_dest from perfiles p left join auth.users au on au.id = p.user_id where p.user_id = u;
    if v_dest is not null then
      perform correo_encolar(v_dest,
        '📝 Banco de Facturas · ' || v_nombre || ' · ' || v_marca || ' · ' ||
          case when v_cant = 1 then 'nueva tarea: ' || btrim(p_titulo) || ' · vence ' || to_char(v_fechas[1], 'DD/MM')
               else v_cant || ' tareas nuevas: ' || btrim(p_titulo) || ' · del ' || to_char(v_fechas[1], 'DD/MM') || ' al ' || to_char(v_fechas[v_cant], 'DD/MM') end,
        '👋 Hola ' || v_nombre || E',\n\nTe asignaron ' || case when v_cant = 1 then 'una tarea' else v_cant || ' tareas' end || E' en el Banco de Facturas:\n\n' ||
        v_tipo || ': ' || btrim(p_titulo) ||
        E'\n🏷️ Marca: ' || v_marca || ' (toda la marca, todas sus sedes)' ||
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
revoke all on function tarea_asignar_marca(uuid[], text, text, text, int, date[], jsonb, text, int) from public, anon;
grant execute on function tarea_asignar_marca(uuid[], text, text, text, int, date[], jsonb, text, int) to authenticated, service_role;

-- PRUEBA (se revierte sola): crea una tarea por marca para el administrador, cuenta tareas y correos, y deshace todo
-- do $t$ declare u uuid; m int; n int; k0 int; k1 int; begin
--   select user_id into u from perfiles where rol = 'admin' and coalesce(activo, true) limit 1;
--   select id into m from marcas order by id limit 1;
--   perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
--   select count(*) into k0 from correo_cola;
--   n := tarea_asignar_marca(array[u], 'otra', 'Prueba por marca', null, m, array[current_date, current_date + 1], null, 'prueba', 0);
--   select count(*) into k1 from correo_cola;
--   raise exception 'RESULTADO tareas=% correos=% marca_ok=%', n, k1 - k0, (select count(*) from tarea where titulo = 'Prueba por marca' and marca_id = m and sede_id is null);
-- end $t$;
