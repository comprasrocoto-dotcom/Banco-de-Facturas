-- ============================================================
--  EVALUACION DE ANALISTAS Y AUXILIARES (16/10/2026, pedido del usuario)
-- ============================================================
-- Modulo «📈 Evaluacion» (solo administradores): califica de 1 a 100 a cada persona por sus sedes a cargo (envio a contabilidad
-- a tiempo, «Sin asignar» limpio, ingresos sin novedad, correcciones a mano, pedidos y amarres por el punto) y avisa por correo
-- y en la web cuando una sede pasa mas de N dias habiles (sin fines de semana ni festivos) sin enviar a contabilidad o con
-- facturas viejas en «Sin asignar». El calculo de la calificacion vive en js/evaluacion.js; aqui solo los datos y las alertas.
-- Solo aditivo: tablas y funciones nuevas. No cambia permisos de nadie ni lo que cada uno ve.

-- ---------------------------------------------------------------- festivos de Colombia (Ley Emiliani; generados con js/evaluacion.js)
create table if not exists festivo (fecha date primary key, nombre text not null);
alter table festivo enable row level security;
drop policy if exists festivo_leer on festivo;
create policy festivo_leer on festivo for select to authenticated using (true);
insert into festivo (fecha, nombre) values ('2026-01-01','Año Nuevo'), ('2026-01-12','Reyes Magos'), ('2026-03-23','San José'), ('2026-04-02','Jueves Santo'), ('2026-04-03','Viernes Santo'), ('2026-05-01','Día del Trabajo'), ('2026-05-18','Ascensión del Señor'), ('2026-06-08','Corpus Christi'), ('2026-06-15','Sagrado Corazón'), ('2026-06-29','San Pedro y San Pablo'), ('2026-07-20','Independencia'), ('2026-08-07','Batalla de Boyacá'), ('2026-08-17','Asunción de la Virgen'), ('2026-10-12','Día de la Raza'), ('2026-11-02','Todos los Santos'), ('2026-11-16','Independencia de Cartagena'), ('2026-12-08','Inmaculada Concepción'), ('2026-12-25','Navidad'), ('2027-01-01','Año Nuevo'), ('2027-01-11','Reyes Magos'), ('2027-03-22','San José'), ('2027-03-25','Jueves Santo'), ('2027-03-26','Viernes Santo'), ('2027-05-01','Día del Trabajo'), ('2027-05-10','Ascensión del Señor'), ('2027-05-31','Corpus Christi'), ('2027-06-07','Sagrado Corazón'), ('2027-07-05','San Pedro y San Pablo'), ('2027-07-20','Independencia'), ('2027-08-07','Batalla de Boyacá'), ('2027-08-16','Asunción de la Virgen'), ('2027-10-18','Día de la Raza'), ('2027-11-01','Todos los Santos'), ('2027-11-15','Independencia de Cartagena'), ('2027-12-08','Inmaculada Concepción'), ('2027-12-25','Navidad'), ('2028-01-01','Año Nuevo'), ('2028-01-10','Reyes Magos'), ('2028-03-20','San José'), ('2028-04-13','Jueves Santo'), ('2028-04-14','Viernes Santo'), ('2028-05-01','Día del Trabajo'), ('2028-05-29','Ascensión del Señor'), ('2028-06-19','Corpus Christi'), ('2028-06-26','Sagrado Corazón'), ('2028-07-03','San Pedro y San Pablo'), ('2028-07-20','Independencia'), ('2028-08-07','Batalla de Boyacá'), ('2028-08-21','Asunción de la Virgen'), ('2028-10-16','Día de la Raza'), ('2028-11-06','Todos los Santos'), ('2028-11-13','Independencia de Cartagena'), ('2028-12-08','Inmaculada Concepción'), ('2028-12-25','Navidad')
on conflict (fecha) do nothing;

-- dias habiles DESPUES de d1 hasta d2 inclusive (listo el lunes y enviado el martes = 1)
create or replace function dias_habiles(d1 date, d2 date) returns integer language sql stable set search_path = public as $$
  select case when d1 is null or d2 is null or d2 <= d1 then 0 else
    (select count(*)::int from generate_series(d1 + 1, d2, interval '1 day') g(d)
      where extract(isodow from g.d) < 6 and not exists (select 1 from festivo x where x.fecha = g.d::date)) end
$$;

-- ---------------------------------------------------------------- tablas
-- quien responde por cada sede (para la evaluacion; NO cambia lo que la persona puede ver)
create table if not exists evaluacion_responsable (
  user_id   uuid not null references perfiles(user_id) on delete cascade,
  sede_id   int  not null references sedes(id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (user_id, sede_id)
);
create table if not exists evaluacion_config (
  id              int primary key default 1 check (id = 1),
  pesos           jsonb not null default '{"envio":30,"sinAsignar":20,"ingresos":20,"correcciones":15,"proceso":15}',
  dias_alerta     int not null default 2 check (dias_alerta between 1 and 15),
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);
insert into evaluacion_config (id) values (1) on conflict (id) do nothing;
-- foto de cada dia habil del «Sin asignar» por marca (para medir cuantos dias estuvo limpio)
create table if not exists evaluacion_foto (
  dia       date not null,
  marca_id  int  not null references marcas(id) on delete cascade,
  pool      int  not null default 0,
  viejas    int  not null default 0,
  mas_vieja int  not null default 0,
  primary key (dia, marca_id)
);
-- alertas de cada dia (historial) y correo de alertas enviado a cada persona (uno al dia)
create table if not exists evaluacion_alerta (
  dia       date not null,
  user_id   uuid not null references perfiles(user_id) on delete cascade,
  tipo      text not null check (tipo in ('por_enviar', 'sin_asignar')),
  ref_id    int  not null,
  nombre    text,
  cantidad  int  not null default 0,
  max_dias  int  not null default 0,
  creado_en timestamptz not null default now(),
  primary key (dia, user_id, tipo, ref_id)
);
create table if not exists evaluacion_correo (
  dia       date not null,
  user_id   uuid not null references perfiles(user_id) on delete cascade,
  correo_id bigint,
  creado_en timestamptz not null default now(),
  primary key (dia, user_id)
);

alter table evaluacion_responsable enable row level security;
alter table evaluacion_config enable row level security;
alter table evaluacion_foto enable row level security;
alter table evaluacion_alerta enable row level security;
alter table evaluacion_correo enable row level security;
drop policy if exists er_leer on evaluacion_responsable;
create policy er_leer on evaluacion_responsable for select to authenticated using (mi_rol() = 'admin' or user_id = auth.uid());
drop policy if exists ec_leer on evaluacion_config;
create policy ec_leer on evaluacion_config for select to authenticated using (mi_rol() in ('admin', 'pagos'));
drop policy if exists ef_leer on evaluacion_foto;
create policy ef_leer on evaluacion_foto for select to authenticated using (mi_rol() = 'admin');
drop policy if exists ea_leer on evaluacion_alerta;
create policy ea_leer on evaluacion_alerta for select to authenticated using (mi_rol() = 'admin' or user_id = auth.uid());
drop policy if exists eco_leer on evaluacion_correo;
create policy eco_leer on evaluacion_correo for select to authenticated using (mi_rol() = 'admin');
revoke all on evaluacion_responsable, evaluacion_config, evaluacion_foto, evaluacion_alerta, evaluacion_correo from anon;
grant select on festivo, evaluacion_responsable, evaluacion_config, evaluacion_foto, evaluacion_alerta, evaluacion_correo to authenticated;

-- ---------------------------------------------------------------- configuracion (solo administrador)
create or replace function evaluacion_responsables_guardar(p_user uuid, p_sedes int[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador asigna responsables.' using errcode = '42501'; end if;
  if not exists (select 1 from perfiles where user_id = p_user and rol in ('admin', 'pagos')) then raise exception 'Esa persona no es administrador ni analista.' using errcode = '22023'; end if;
  delete from evaluacion_responsable where user_id = p_user and not (sede_id = any (coalesce(p_sedes, '{}'::int[])));
  insert into evaluacion_responsable (user_id, sede_id)
  select p_user, s from unnest(coalesce(p_sedes, '{}'::int[])) s where exists (select 1 from sedes where id = s)
  on conflict do nothing;
  select count(*) into n from evaluacion_responsable where user_id = p_user;
  return n;
end $$;

create or replace function evaluacion_config_guardar(p_pesos jsonb, p_dias int, p_usuario text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v_suma numeric := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador cambia la evaluacion.' using errcode = '42501'; end if;
  foreach k in array array['envio', 'sinAsignar', 'ingresos', 'correcciones', 'proceso'] loop
    if jsonb_typeof(p_pesos -> k) <> 'number' or (p_pesos ->> k)::numeric < 0 then raise exception 'El peso de % tiene que ser un numero de 0 o mas.', k using errcode = '22023'; end if;
    v_suma := v_suma + (p_pesos ->> k)::numeric;
  end loop;
  if v_suma <= 0 then raise exception 'Los pesos no pueden ser todos cero.' using errcode = '22023'; end if;
  if p_dias is null or p_dias < 1 or p_dias > 15 then raise exception 'Los dias de alerta van de 1 a 15.' using errcode = '22023'; end if;
  update evaluacion_config set pesos = jsonb_build_object('envio', p_pesos -> 'envio', 'sinAsignar', p_pesos -> 'sinAsignar', 'ingresos', p_pesos -> 'ingresos', 'correcciones', p_pesos -> 'correcciones', 'proceso', p_pesos -> 'proceso'),
         dias_alerta = p_dias, actualizado_en = now(), actualizado_por = nullif(btrim(coalesce(p_usuario, '')), '')
   where id = 1;
end $$;

-- ---------------------------------------------------------------- datos para calificar (solo administrador)
create or replace function evaluacion_datos(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador ve la evaluacion.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'perfiles', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'nombre', nombre, 'rol', rol, 'activo', activo)), '[]') from perfiles),
    'sedes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'marca_id', marca_id)), '[]') from sedes),
    'marcas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre)), '[]') from marcas),
    'facturas', (select coalesce(jsonb_agg(jsonb_build_object('cufe', cufe, 'sede_id', sede_id, 'marca_id', marca_id, 'tipo', tipo, 'estado', estado,
        'num_ingreso', num_ingreso, 'fecha_ingreso', fecha_ingreso, 'sellada_en', sellada_en, 'created_at', created_at, 'prefijo', prefijo, 'folio', folio, 'emisor', emisor)), '[]') from facturas),
    'pedidos', (select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'sede_id', sede_id, 'factura_cufe', factura_cufe, 'estado', estado)), '[]') from pedidos),
    'historial', (select coalesce(jsonb_agg(jsonb_build_object('accion', accion, 'usuario', usuario, 'detalle', detalle, 'created_at', created_at)), '[]') from historial
                   where created_at >= p_desde - 1 and created_at < p_hasta + 2
                     and accion in ('pedido creado desde la web', 'pedido amarrado', 'pedido amarrado por foto', 'numero de ingreso ERP (manual)',
                                    'pedido desamarrado', 'sello quitado - devuelta al pool', 'pedido borrado', 'factura borrada')),
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

-- ---------------------------------------------------------------- alertas (la web la llama al cargar; una vez al dia manda el correo)
-- -> { dia, habil, dias_alerta, alertas: [{ user_id, persona, tipo, ref_id, nombre, cantidad, max_dias }] }
create or replace function evaluacion_alertas_generar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_hoy date := (now() at time zone 'America/Bogota')::date; v_dias int; v_habil boolean; v_out jsonb; r record; v_dest text; v_cuerpo text; v_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then raise exception 'sin permiso' using errcode = '42501'; end if;
  select dias_alerta into v_dias from evaluacion_config where id = 1;
  v_dias := coalesce(v_dias, 2);
  v_habil := extract(isodow from v_hoy) < 6 and not exists (select 1 from festivo where fecha = v_hoy);

  -- 1) foto del dia habil del «Sin asignar» por marca (se actualiza en cada llamada del dia: queda la ultima)
  if v_habil then
    insert into evaluacion_foto (dia, marca_id, pool, viejas, mas_vieja)
    select v_hoy, m.id, count(f.cufe),
           count(f.cufe) filter (where dias_habiles((f.created_at at time zone 'America/Bogota')::date, v_hoy) > v_dias),
           coalesce(max(dias_habiles((f.created_at at time zone 'America/Bogota')::date, v_hoy)), 0)
      from marcas m left join facturas f on f.marca_id = m.id and f.estado::text = 'pool'
     group by m.id
    on conflict (dia, marca_id) do update set pool = excluded.pool, viejas = excluded.viejas, mas_vieja = excluded.mas_vieja;
  end if;

  -- 2) alertas de ahora por responsable
  with listos as (
    select f.sede_id,
           greatest(f.fecha_ingreso::date, coalesce(case when f.tipo::text <> 'nota_credito' then (f.sellada_en at time zone 'America/Bogota')::date end, f.fecha_ingreso::date)) as listo
      from facturas f
     where coalesce(btrim(f.num_ingreso), '') not in ('', 'null') and f.fecha_ingreso is not null and f.sede_id is not null
       and (f.tipo::text = 'nota_credito' or f.estado::text in ('sellada', 'pagada'))
       and not exists (select 1 from contabilidad_envio e where e.factura_cufe = f.cufe)
  ), vencidos as (
    select sede_id, count(*) as cantidad, max(dias_habiles(listo, v_hoy)) as max_dias
      from listos where dias_habiles(listo, v_hoy) > v_dias group by sede_id
  ), pool as (
    select f.marca_id, count(*) filter (where dias_habiles((f.created_at at time zone 'America/Bogota')::date, v_hoy) > v_dias) as viejas,
           max(dias_habiles((f.created_at at time zone 'America/Bogota')::date, v_hoy)) as mas_vieja
      from facturas f where f.estado::text = 'pool' and f.marca_id is not null group by f.marca_id
  ), todas as (
    select er.user_id, 'por_enviar'::text as tipo, s.id as ref_id, s.nombre, v.cantidad::int, v.max_dias::int
      from evaluacion_responsable er join sedes s on s.id = er.sede_id join vencidos v on v.sede_id = s.id
    union
    select distinct er.user_id, 'sin_asignar'::text, m.id, m.nombre, p.viejas::int, p.mas_vieja::int
      from evaluacion_responsable er join sedes s on s.id = er.sede_id join marcas m on m.id = s.marca_id join pool p on p.marca_id = m.id
     where p.viejas > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('user_id', t.user_id, 'persona', pe.nombre, 'tipo', t.tipo, 'ref_id', t.ref_id, 'nombre', t.nombre,
                                               'cantidad', t.cantidad, 'max_dias', t.max_dias) order by pe.nombre, t.tipo, t.nombre), '[]'::jsonb)
    into v_out
    from todas t join perfiles pe on pe.user_id = t.user_id and coalesce(pe.activo, true);

  insert into evaluacion_alerta (dia, user_id, tipo, ref_id, nombre, cantidad, max_dias)
  select v_hoy, (x ->> 'user_id')::uuid, x ->> 'tipo', (x ->> 'ref_id')::int, x ->> 'nombre', (x ->> 'cantidad')::int, (x ->> 'max_dias')::int
    from jsonb_array_elements(v_out) x
  on conflict (dia, user_id, tipo, ref_id) do update set cantidad = excluded.cantidad, max_dias = excluded.max_dias;

  -- 3) un correo al dia (solo dias habiles) a cada persona con alertas, con copia a compras
  if v_habil then
    for r in select (x ->> 'user_id')::uuid as uid, min(x ->> 'persona') as persona,
                    string_agg(case when x ->> 'tipo' = 'por_enviar'
                                    then '- ' || (x ->> 'nombre') || ': ' || (x ->> 'cantidad') || ' documento(s) terminados SIN ENVIAR a contabilidad (el mas viejo lleva ' || (x ->> 'max_dias') || ' dias habiles).'
                                    else '- ' || (x ->> 'nombre') || ': ' || (x ->> 'cantidad') || ' factura(s) en «Sin asignar» con mas de ' || v_dias || ' dias habiles (la mas vieja lleva ' || (x ->> 'max_dias') || ').' end,
                               E'\n' order by x ->> 'tipo', x ->> 'nombre') as lineas
               from jsonb_array_elements(v_out) x group by 1 loop
      continue when exists (select 1 from evaluacion_correo c where c.dia = v_hoy and c.user_id = r.uid);
      select coalesce(nullif(btrim(p.correo_avisos), ''), u.email::text) into v_dest
        from perfiles p left join auth.users u on u.id = p.user_id where p.user_id = r.uid;
      v_id := null;
      if v_dest is not null then
        v_cuerpo := 'Hola ' || coalesce(r.persona, '') || E',\n\nEstas son las alertas de hoy (' || to_char(v_hoy, 'DD/MM/YYYY') || E') en el Banco de Facturas:\n\n' || r.lineas ||
                    E'\n\nEntra a la web: Facturas > «📤 Por enviar a contabilidad» y «Sin asignar», y dejalo al dia.' ||
                    E'\n\n(Correo automatico del Banco de Facturas, uno al dia. Los dias habiles no cuentan sabados, domingos ni festivos.)';
        select c.correo_id into v_id from correo_encolar(v_dest, 'Banco de Facturas: alertas de hoy ' || to_char(v_hoy, 'DD/MM'), v_cuerpo, null, null, null, null, 'comprasrocoto@gmail.com') c;
      end if;
      insert into evaluacion_correo (dia, user_id, correo_id) values (v_hoy, r.uid, v_id) on conflict do nothing;
    end loop;
  end if;

  return jsonb_build_object('dia', v_hoy, 'habil', v_habil, 'dias_alerta', v_dias, 'alertas', v_out);
end $$;

revoke all on function evaluacion_responsables_guardar(uuid, int[]), evaluacion_config_guardar(jsonb, int, text), evaluacion_datos(date, date), evaluacion_alertas_generar() from public, anon;
grant execute on function evaluacion_responsables_guardar(uuid, int[]), evaluacion_config_guardar(jsonb, int, text), evaluacion_datos(date, date), evaluacion_alertas_generar() to authenticated, service_role;
grant execute on function dias_habiles(date, date) to authenticated, service_role;
