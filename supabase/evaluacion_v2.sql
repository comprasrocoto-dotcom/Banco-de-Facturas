-- ============================================================
--  EVALUACION v2 (16/10/2026, pedido del usuario): metas nuevas y correos mas faciles de identificar
-- ============================================================
--  * Envio a contabilidad A DIARIO: lo que el agente deja listo (ingresado + sellado) antes de la hora de corte (5 p. m.) se
--    envia ESE dia; lo que queda listo despues (o en fin de semana / festivo), el siguiente dia habil antes de las 12 m.
--  * «Sin asignar»: maximo N facturas por marca (5) y en 0 el primer dia habil de cada mes.
--  * Analistas: no deben crear pedidos, amarrar ni asignar sede (eso es del punto) -> datos de «asignada» en el historial.
--  * % de ingresos hechos a mano: hora del ingreso del agente (ingreso_documento) y de las personas (historial).
--  * Correos con emoji en el asunto y en cada linea.
-- Solo aditivo: columnas nuevas con valor por defecto, funciones nuevas y reemplazo de las funciones de la evaluacion v1.

alter table evaluacion_config add column if not exists hora_corte int not null default 17 check (hora_corte between 6 and 23);
alter table evaluacion_config add column if not exists hora_manana int not null default 12 check (hora_manana between 6 and 23);
alter table evaluacion_config add column if not exists max_sin_asignar int not null default 5 check (max_sin_asignar between 0 and 500);

-- ---------------------------------------------------------------- dias habiles y limite de envio
create or replace function evaluacion_es_habil(d date) returns boolean language sql stable set search_path = public as
$$ select extract(isodow from d) < 6 and not exists (select 1 from festivo where fecha = d) $$;

create or replace function evaluacion_siguiente_habil(d date) returns date language plpgsql stable set search_path = public as $$
declare x date := d + 1;
begin
  while not evaluacion_es_habil(x) loop x := x + 1; end loop;
  return x;
end $$;

create or replace function evaluacion_primer_habil_mes(d date) returns date language plpgsql stable set search_path = public as $$
declare x date := date_trunc('month', d)::date;
begin
  while not evaluacion_es_habil(x) loop x := x + 1; end loop;
  return x;
end $$;

-- hasta cuando hay para enviar algo que quedo listo en p_listo
create or replace function evaluacion_limite_envio(p_listo timestamptz, p_corte int default 17, p_manana int default 12) returns timestamptz
language plpgsql stable set search_path = public as $$
declare l timestamp; d date;
begin
  if p_listo is null then return null; end if;
  l := p_listo at time zone 'America/Bogota'; d := l::date;
  if evaluacion_es_habil(d) and l::time < make_time(p_corte, 0, 0) then return (d + make_time(p_corte, 0, 0)) at time zone 'America/Bogota'; end if;
  return (evaluacion_siguiente_habil(d) + make_time(p_manana, 0, 0)) at time zone 'America/Bogota';
end $$;

-- instante en que un documento quedo listo para enviar: el ultimo entre el ingreso (agente o persona) y el sello.
-- Si no se sabe la hora del ingreso: las 5 p. m. de su dia de ingreso (plazo hasta el dia habil siguiente).
create or replace function evaluacion_listo_en(p_cufe text) returns timestamptz language sql stable security definer set search_path = public as $$
  select greatest(
           coalesce(
             (select max(d.terminado_en) from ingreso_documento d where d.factura_cufe = f.cufe and d.estado = 'COMPLETADO'),
             (select max(h.created_at) from historial h where h.cufe = f.cufe and h.accion like 'numero de ingreso ERP%'),
             case when f.fecha_ingreso is not null then (f.fecha_ingreso::date + time '17:00') at time zone 'America/Bogota' end),
           case when f.tipo::text <> 'nota_credito' then f.sellada_en end)
    from facturas f where f.cufe = p_cufe
$$;

-- ---------------------------------------------------------------- configuracion (pesos en % que suman 100 + metas)
drop function if exists evaluacion_config_guardar(jsonb, int, text);
create or replace function evaluacion_config_guardar(p_pesos jsonb, p_dias int default null, p_usuario text default null,
                                                     p_hora_corte int default null, p_hora_manana int default null, p_max_sin_asignar int default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v_suma numeric := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador cambia la evaluacion.' using errcode = '42501'; end if;
  foreach k in array array['envio', 'sinAsignar', 'ingresos', 'correcciones', 'proceso'] loop
    if jsonb_typeof(p_pesos -> k) <> 'number' or (p_pesos ->> k)::numeric < 0 then raise exception 'El peso de % tiene que ser un numero de 0 o mas.', k using errcode = '22023'; end if;
    v_suma := v_suma + (p_pesos ->> k)::numeric;
  end loop;
  if v_suma <> 100 then raise exception 'Los pesos tienen que sumar 100%% (suman %).', v_suma using errcode = '22023'; end if;
  if p_hora_corte is not null and (p_hora_corte < 6 or p_hora_corte > 23) then raise exception 'La hora de corte va de 6 a 23.' using errcode = '22023'; end if;
  if p_hora_manana is not null and (p_hora_manana < 6 or p_hora_manana > 23) then raise exception 'La hora de la mañana va de 6 a 23.' using errcode = '22023'; end if;
  if p_max_sin_asignar is not null and (p_max_sin_asignar < 0 or p_max_sin_asignar > 500) then raise exception 'El maximo de Sin asignar va de 0 a 500.' using errcode = '22023'; end if;
  update evaluacion_config set
         pesos = jsonb_build_object('envio', p_pesos -> 'envio', 'sinAsignar', p_pesos -> 'sinAsignar', 'ingresos', p_pesos -> 'ingresos', 'correcciones', p_pesos -> 'correcciones', 'proceso', p_pesos -> 'proceso'),
         dias_alerta = coalesce(p_dias, dias_alerta),
         hora_corte = coalesce(p_hora_corte, hora_corte), hora_manana = coalesce(p_hora_manana, hora_manana), max_sin_asignar = coalesce(p_max_sin_asignar, max_sin_asignar),
         actualizado_en = now(), actualizado_por = nullif(btrim(coalesce(p_usuario, '')), '')
   where id = 1;
end $$;

-- ---------------------------------------------------------------- datos para calificar (solo administrador)
create or replace function evaluacion_datos(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador ve la evaluacion.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'perfiles', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'nombre', nombre, 'rol', rol, 'activo', activo, 'sede_id', sede_id)), '[]') from perfiles),
    'sedes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'marca_id', marca_id)), '[]') from sedes),
    'marcas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre)), '[]') from marcas),
    'facturas', (select coalesce(jsonb_agg(jsonb_build_object('cufe', cufe, 'sede_id', sede_id, 'marca_id', marca_id, 'tipo', tipo, 'estado', estado,
        'num_ingreso', num_ingreso, 'fecha_ingreso', fecha_ingreso, 'sellada_en', sellada_en, 'created_at', created_at, 'prefijo', prefijo, 'folio', folio, 'emisor', emisor)), '[]') from facturas),
    'pedidos', (select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'sede_id', sede_id, 'factura_cufe', factura_cufe, 'estado', estado)), '[]') from pedidos),
    'historial', (select coalesce(jsonb_agg(jsonb_build_object('accion', accion, 'usuario', usuario, 'cufe', cufe, 'detalle', detalle, 'created_at', created_at)), '[]') from historial
                   where created_at >= p_desde - 7 and created_at < p_hasta + 2
                     and accion in ('pedido creado desde la web', 'pedido amarrado', 'pedido amarrado por foto', 'numero de ingreso ERP', 'numero de ingreso ERP (manual)',
                                    'pedido desamarrado', 'sello quitado - devuelta al pool', 'pedido borrado', 'factura borrada', 'asignada', 'asignada por admin')),
    'docs_ingreso', (select coalesce(jsonb_agg(jsonb_build_object('factura_cufe', factura_cufe, 'terminado_en', t)), '[]')
                      from (select factura_cufe, max(terminado_en) as t from ingreso_documento where estado = 'COMPLETADO' and factura_cufe is not null group by factura_cufe) x),
    'envios', (select coalesce(jsonb_agg(jsonb_build_object('factura_cufe', factura_cufe, 'lote_id', lote_id, 'enviada_en', enviada_en)), '[]') from contabilidad_envio),
    'lotes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'creado_por', creado_por, 'usuario', usuario, 'creado_en', creado_en, 'anulado', anulado)), '[]') from contabilidad_lote),
    'avisos', (select coalesce(jsonb_agg(jsonb_build_object('factura_cufe', factura_cufe, 'pedido_numero', pedido_numero, 'motivo', motivo, 'creado_en', creado_en)), '[]') from agente_aviso
                where creado_en >= p_desde - 30),
    'ordenes', (select coalesce(jsonb_agg(jsonb_build_object('pedida_por', pedida_por, 'pedida_en', pedida_en, 'tipo', tipo)), '[]') from ordenes
                 where pedida_en >= p_desde - 1 and pedida_en < p_hasta + 2),
    'responsables', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'sede_id', sede_id)), '[]') from evaluacion_responsable),
    'config', (select to_jsonb(c) from evaluacion_config c where id = 1),
    'fotos', (select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'marca_id', marca_id, 'pool', pool, 'viejas', viejas)), '[]') from evaluacion_foto where dia between p_desde and p_hasta),
    'alertas', (select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'user_id', user_id, 'tipo', tipo, 'nombre', nombre, 'cantidad', cantidad, 'max_dias', max_dias)), '[]') from evaluacion_alerta where dia between p_desde and p_hasta)
  );
end $$;

-- ---------------------------------------------------------------- alertas (la web la llama al cargar; un correo por dia habil)
-- -> { dia, habil, hora_corte, hora_manana, max_sin_asignar, meta_hoy, alertas: [{ user_id, persona, tipo, ref_id, nombre, cantidad, max_dias, desde }] }
create or replace function evaluacion_alertas_generar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_hoy date := (now() at time zone 'America/Bogota')::date; v_cfg evaluacion_config%rowtype; v_habil boolean; v_meta int; v_out jsonb;
        r record; v_dest text; v_cuerpo text; v_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then raise exception 'sin permiso' using errcode = '42501'; end if;
  select * into v_cfg from evaluacion_config where id = 1;
  v_habil := evaluacion_es_habil(v_hoy);
  v_meta := case when v_hoy = evaluacion_primer_habil_mes(v_hoy) then 0 else coalesce(v_cfg.max_sin_asignar, 5) end;

  -- 1) foto del dia habil del «Sin asignar» por marca (se actualiza en cada llamada del dia: queda la ultima)
  if v_habil then
    insert into evaluacion_foto (dia, marca_id, pool, viejas, mas_vieja)
    select v_hoy, m.id, count(f.cufe), 0, coalesce(max(dias_habiles((f.created_at at time zone 'America/Bogota')::date, v_hoy)), 0)
      from marcas m left join facturas f on f.marca_id = m.id and f.estado::text = 'pool'
     group by m.id
    on conflict (dia, marca_id) do update set pool = excluded.pool, mas_vieja = excluded.mas_vieja;
  end if;

  -- 2) alertas de ahora por responsable
  with listos as (
    select f.sede_id, evaluacion_listo_en(f.cufe) as listo
      from facturas f
     where coalesce(btrim(f.num_ingreso), '') not in ('', 'null') and f.sede_id is not null
       and (f.tipo::text = 'nota_credito' or f.estado::text in ('sellada', 'pagada'))
       and not exists (select 1 from contabilidad_envio e where e.factura_cufe = f.cufe)
  ), vencidos as (
    select sede_id, count(*) as cantidad, min(listo) as desde, max(dias_habiles((listo at time zone 'America/Bogota')::date, v_hoy)) as max_dias
      from listos where listo is not null and now() > evaluacion_limite_envio(listo, coalesce(v_cfg.hora_corte, 17), coalesce(v_cfg.hora_manana, 12))
     group by sede_id
  ), pool as (
    select f.marca_id, count(*) as cantidad, max(dias_habiles((f.created_at at time zone 'America/Bogota')::date, v_hoy)) as max_dias
      from facturas f where f.estado::text = 'pool' and f.marca_id is not null group by f.marca_id
  ), todas as (
    select er.user_id, 'por_enviar'::text as tipo, s.id as ref_id, s.nombre, v.cantidad::int, v.max_dias::int, v.desde
      from evaluacion_responsable er join sedes s on s.id = er.sede_id join vencidos v on v.sede_id = s.id
    union
    select distinct er.user_id, 'sin_asignar'::text, m.id, m.nombre, p.cantidad::int, p.max_dias::int, null::timestamptz
      from evaluacion_responsable er join sedes s on s.id = er.sede_id join marcas m on m.id = s.marca_id join pool p on p.marca_id = m.id
     where p.cantidad > v_meta
  )
  select coalesce(jsonb_agg(jsonb_build_object('user_id', t.user_id, 'persona', pe.nombre, 'tipo', t.tipo, 'ref_id', t.ref_id, 'nombre', t.nombre,
                                               'cantidad', t.cantidad, 'max_dias', t.max_dias, 'desde', t.desde) order by pe.nombre, t.tipo, t.nombre), '[]'::jsonb)
    into v_out
    from todas t join perfiles pe on pe.user_id = t.user_id and coalesce(pe.activo, true);

  insert into evaluacion_alerta (dia, user_id, tipo, ref_id, nombre, cantidad, max_dias)
  select v_hoy, (x ->> 'user_id')::uuid, x ->> 'tipo', (x ->> 'ref_id')::int, x ->> 'nombre', (x ->> 'cantidad')::int, (x ->> 'max_dias')::int
    from jsonb_array_elements(v_out) x
  on conflict (dia, user_id, tipo, ref_id) do update set cantidad = excluded.cantidad, max_dias = excluded.max_dias;

  -- 3) un correo al dia (solo dias habiles) a cada persona con alertas, con copia a compras
  if v_habil then
    for r in select (x ->> 'user_id')::uuid as uid, min(x ->> 'persona') as persona,
                    count(*) filter (where x ->> 'tipo' = 'por_enviar') as n_env, count(*) filter (where x ->> 'tipo' = 'sin_asignar') as n_sa,
                    string_agg(case when x ->> 'tipo' = 'por_enviar'
                                    then '📤 ' || (x ->> 'nombre') || ': ' || (x ->> 'cantidad') || ' documento(s) procesados SIN ENVIAR a contabilidad (listos desde el ' || to_char((x ->> 'desde')::timestamptz at time zone 'America/Bogota', 'DD/MM HH24:MI') || ').'
                                    else '🗂️ ' || (x ->> 'nombre') || ': ' || (x ->> 'cantidad') || ' factura(s) en «Sin asignar» (meta de hoy: máximo ' || v_meta || ').' end,
                               E'\n' order by x ->> 'tipo', x ->> 'nombre') as lineas
               from jsonb_array_elements(v_out) x group by 1 loop
      continue when exists (select 1 from evaluacion_correo c where c.dia = v_hoy and c.user_id = r.uid);
      select coalesce(nullif(btrim(p.correo_avisos), ''), u.email::text) into v_dest
        from perfiles p left join auth.users u on u.id = p.user_id where p.user_id = r.uid;
      v_id := null;
      if v_dest is not null then
        v_cuerpo := '👋 Hola ' || coalesce(r.persona, '') || E',\n\n🚨 Esto quedó pendiente en el Banco de Facturas (' || to_char(v_hoy, 'DD/MM/YYYY') || E'):\n\n' || r.lineas ||
                    E'\n\n⏰ Regla de envío: lo que el agente deja listo antes de las ' || coalesce(v_cfg.hora_corte, 17) || ':00 se envía a contabilidad ESE MISMO DÍA; ' ||
                    'lo que queda listo después, el siguiente día hábil antes de las ' || coalesce(v_cfg.hora_manana, 12) || ':00.' ||
                    E'\n🗂️ Meta de «Sin asignar»: máximo ' || coalesce(v_cfg.max_sin_asignar, 5) || ' facturas por marca, y en 0 el primer día hábil de cada mes.' ||
                    E'\n\n👉 Entra a la web: Facturas > «📤 Por enviar a contabilidad» y «Sin asignar».' ||
                    E'\n\n🤖 Correo automático del Banco de Facturas (uno al día hábil; no cuenta sábados, domingos ni festivos).';
        select c.correo_id into v_id from correo_encolar(v_dest,
               '🚨 Banco de Facturas · ' || coalesce(r.persona, '') || ' · ' ||
               case when r.n_env > 0 and r.n_sa > 0 then '📤 Por enviar + 🗂️ Sin asignar' when r.n_env > 0 then '📤 Pendiente enviar a contabilidad' else '🗂️ Sin asignar fuera de la meta' end ||
               ' · ' || to_char(v_hoy, 'DD/MM'),
               v_cuerpo, null, null, null, null, 'comprasrocoto@gmail.com') c;
      end if;
      insert into evaluacion_correo (dia, user_id, correo_id) values (v_hoy, r.uid, v_id) on conflict do nothing;
    end loop;
  end if;

  return jsonb_build_object('dia', v_hoy, 'habil', v_habil, 'hora_corte', coalesce(v_cfg.hora_corte, 17), 'hora_manana', coalesce(v_cfg.hora_manana, 12),
                            'max_sin_asignar', coalesce(v_cfg.max_sin_asignar, 5), 'meta_hoy', v_meta, 'dias_alerta', v_cfg.dias_alerta, 'alertas', v_out);
end $$;

revoke all on function evaluacion_config_guardar(jsonb, int, text, int, int, int), evaluacion_listo_en(text) from public, anon;
grant execute on function evaluacion_config_guardar(jsonb, int, text, int, int, int), evaluacion_listo_en(text) to authenticated, service_role;
grant execute on function evaluacion_es_habil(date), evaluacion_siguiente_habil(date), evaluacion_primer_habil_mes(date), evaluacion_limite_envio(timestamptz, int, int) to authenticated, service_role;
