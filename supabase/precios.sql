-- ============================================================
--  VARIACION DE PRECIOS DE PROVEEDORES  -  21/09/2026
--  Cada vez que se registra un precio (lo que trae la factura, una lista del proveedor o a mano) se compara con el ULTIMO precio que ese proveedor
--  cobro por ese articulo (o, si es la primera vez, con el precio negociado del catalogo). Si cambia el umbral (5 % por defecto) se crea una
--  VARIACION, y un RESUMEN DIARIO por correo la avisa.
--
--  SOLO AGREGA: 4 tablas nuevas + funciones nuevas. No cambia ninguna tabla, columna ni politica existente.
--  El correo usa la cola que ya existia (correo_encolar / correo_cola); el vigilante lo envia por Gmail como los demas.
--
--  precio_registrar(lineas, fuente, aplicar)  -> registra precios y crea variaciones (aplicar=false: solo simula)
--  precio_resumen_diario(forzar)              -> arma y encola el correo con las variaciones que aun no se han avisado (1 al dia)
--  precio_revisar(id, estado, nota)           -> marcar una variacion como revisada / descartada
--  precio_config_guardar(clave, valor)        -> cambiar umbral, correos, hora del resumen (solo admin)
-- ============================================================

-- ---------- configuracion ----------
create table if not exists precio_config (
  clave          text primary key,
  valor          text not null,
  descripcion    text,
  actualizado_en timestamptz not null default now()
);
insert into precio_config (clave, valor, descripcion) values
  ('umbral_pct',      '5',                        'Cambio minimo, en %, para crear la variacion y avisar'),
  ('correos',         'comprasrocoto@gmail.com',  'Correos (separados por coma) que reciben el resumen diario'),
  ('resumen_hora',    '17',                       'Hora de Colombia (0-23) desde la que se envia el resumen diario'),
  ('resumen_activo',  'true',                     'Enviar el resumen diario por correo (true / false)'),
  ('ultimo_resumen',  '',                         'Fecha (Colombia) del ultimo resumen enviado')
on conflict (clave) do nothing;

-- ---------- historial de precios ----------
create table if not exists precio_historial (
  id               bigserial primary key,
  proveedor_nit    text not null,
  proveedor_nombre text,
  articulo_clave   text not null,          -- imp_clave(articulo): sin tildes, signos ni espacios
  articulo_texto   text not null,          -- como lo escribe el proveedor
  codigo           text,                   -- codigo del articulo en nuestro catalogo, si se sabe
  unidad           text,
  precio           numeric(14,2) not null check (precio > 0),
  cantidad         numeric,
  fecha            date not null,
  fuente           text not null check (fuente in ('factura', 'lista', 'manual')),
  factura_ref      text,
  factura_cufe     text,
  pedido_numero    text,
  creado_por       text,
  creado_en        timestamptz not null default now()
);
create unique index if not exists ux_precio_historial_dup
  on precio_historial (proveedor_nit, articulo_clave, fecha, precio, fuente, (coalesce(factura_ref, '')));
create index if not exists ix_precio_historial_art on precio_historial (proveedor_nit, articulo_clave, fecha desc, id desc);

-- ---------- variaciones ----------
create table if not exists precio_variacion (
  id               bigserial primary key,
  historial_id     bigint not null unique references precio_historial (id) on delete cascade,
  proveedor_nit    text not null,
  proveedor_nombre text,
  articulo_clave   text not null,
  articulo_texto   text not null,
  precio_anterior  numeric(14,2) not null,
  fecha_anterior   date,                   -- null si se comparo contra el precio negociado
  precio_nuevo     numeric(14,2) not null,
  fecha_nueva      date not null,
  variacion_pct    numeric(9,2) not null,  -- + sube, - baja
  base             text not null check (base in ('ultimo', 'negociado')),
  factura_ref      text,
  estado           text not null default 'nueva' check (estado in ('nueva', 'revisada', 'descartada')),
  nota             text,
  revisada_por     text,
  revisada_en      timestamptz,
  correo_en        timestamptz,            -- cuando entro en un resumen enviado
  creado_en        timestamptz not null default now()
);
create index if not exists ix_precio_variacion_estado on precio_variacion (estado, fecha_nueva desc);

alter table precio_config    enable row level security;
alter table precio_historial enable row level security;
alter table precio_variacion enable row level security;
drop policy if exists precio_config_ver on precio_config;
create policy precio_config_ver on precio_config for select to authenticated using (mi_rol() in ('admin', 'pagos'));
drop policy if exists precio_historial_ver on precio_historial;
create policy precio_historial_ver on precio_historial for select to authenticated using (mi_rol() in ('admin', 'pagos'));
drop policy if exists precio_variacion_ver on precio_variacion;
create policy precio_variacion_ver on precio_variacion for select to authenticated using (mi_rol() in ('admin', 'pagos'));
-- (sin politicas de escritura: solo las funciones de abajo, que son security definer, escriben)

-- ---------- utilidades ----------
create or replace function precio_puede() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(auth.role(), '') = 'service_role' or mi_rol() in ('admin', 'pagos') $$;

create or replace function precio_cfg(p_clave text) returns text language sql stable security definer set search_path = public as
$$ select valor from precio_config where clave = p_clave $$;

-- "$ 48.500" o "$ 1.527,50"
create or replace function precio_fmt(n numeric) returns text language sql immutable as
$$ select '$ ' || case when n = trunc(n) then replace(to_char(n, 'FM999,999,999,990'), ',', '.')
                       else replace(replace(replace(to_char(n, 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.') end $$;
create or replace function precio_fmt_pct(p numeric) returns text language sql immutable as
$$ select case when p > 0 then '+' else '' end || replace(to_char(p, 'FM990.0'), '.', ',') || ' %' $$;

-- ---------- registrar precios ----------
create or replace function precio_registrar(p_lineas jsonb, p_fuente text default 'factura', p_aplicar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_l jsonb; v_i bigint; v_n int;
  v_umbral numeric := coalesce(nullif(precio_cfg('umbral_pct'), '')::numeric, 5);
  v_hoy date := (timezone('America/Bogota', now()))::date;
  v_nit text; v_nom text; v_art text; v_clave text; v_precio numeric; v_fecha date; v_ref text; v_cufe text; v_ped text; v_cod text; v_uni text; v_cant numeric;
  v_err text[]; v_est text; v_var jsonb;
  v_prev record; v_hid bigint; v_ant numeric; v_fant date; v_base text; v_pct numeric;
  v_reg int := 0; v_dup int := 0; v_errs int := 0; v_vars int := 0; v_quien text;
  v_filas jsonb := '[]'::jsonb;
begin
  if not precio_puede() then raise exception 'Sin permiso para registrar precios.' using errcode = '42501'; end if;
  if p_fuente not in ('factura', 'lista', 'manual') then raise exception 'Fuente desconocida: %', p_fuente using errcode = '22023'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then raise exception 'Las lineas deben venir como una lista.' using errcode = '22023'; end if;
  if jsonb_array_length(p_lineas) > 2000 then raise exception 'Maximo 2.000 lineas por llamada (trae %).', jsonb_array_length(p_lineas) using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('precio_registrar'));
  select coalesce(nombre, 'sistema') into v_quien from perfiles where user_id = auth.uid();
  v_quien := coalesce(v_quien, case when coalesce(auth.role(), '') = 'service_role' then 'agente' else 'sistema' end);

  for v_l, v_i in select value, ordinality from jsonb_array_elements(p_lineas) with ordinality loop
    v_err := '{}'; v_est := null; v_var := null; v_hid := null;
    v_n := case when (v_l ->> 'n') ~ '^[0-9]+$' then (v_l ->> 'n')::int else v_i::int end;
    v_nit := regexp_replace(coalesce(v_l ->> 'nit', ''), '\D', '', 'g');
    v_nom := imp_txt(v_l, 'proveedor'); v_art := imp_txt(v_l, 'articulo'); v_ref := imp_txt(v_l, 'factura'); v_cufe := imp_txt(v_l, 'cufe');
    v_ped := imp_txt(v_l, 'pedido'); v_cod := imp_txt(v_l, 'codigo'); v_uni := imp_txt(v_l, 'unidad');
    if length(v_nit) < 5 or length(v_nit) > 15 then v_err := array_append(v_err, 'el NIT del proveedor no es valido'::text); end if;
    if v_art is null then v_err := array_append(v_err, 'falta el articulo'::text); end if;
    if not imp_num_ok(v_l ->> 'precio') or imp_num(v_l ->> 'precio') is null then v_err := array_append(v_err, 'el precio no es un numero'::text);
    else
      v_precio := imp_num(v_l ->> 'precio');
      if v_precio <= 0 then v_err := array_append(v_err, 'el precio debe ser mayor que 0'::text); elsif v_precio > 1000000000 then v_err := array_append(v_err, 'el precio es absurdo'::text); end if;
    end if;
    v_cant := case when imp_num_ok(v_l ->> 'cantidad') then imp_num(v_l ->> 'cantidad') else null end;
    if coalesce(imp_txt(v_l, 'fecha'), '') = '' then v_fecha := v_hoy;
    elsif (v_l ->> 'fecha') ~ '^\d{4}-\d{2}-\d{2}$' then
      begin v_fecha := (v_l ->> 'fecha')::date; exception when others then v_fecha := null; v_err := array_append(v_err, 'la fecha no es valida'::text); end;
      if v_fecha > v_hoy then v_err := array_append(v_err, 'la fecha es futura'::text); end if;
    else v_fecha := null; v_err := array_append(v_err, 'la fecha debe ser AAAA-MM-DD'::text); end if;
    v_clave := case when v_art is null then '' else imp_clave(v_art) end;
    if v_art is not null and v_clave = '' then v_err := array_append(v_err, 'el nombre del articulo no tiene letras ni numeros'::text); end if;

    if cardinality(v_err) = 0 then
      if exists (select 1 from precio_historial where proveedor_nit = v_nit and articulo_clave = v_clave and fecha = v_fecha and precio = v_precio and fuente = p_fuente
                 and coalesce(factura_ref, '') = coalesce(v_ref, '')) then
        v_est := 'duplicado'; v_dup := v_dup + 1;
      else
        v_est := 'nuevo'; v_reg := v_reg + 1;
        -- contra que se compara: el ultimo precio de ese proveedor por ese articulo; si no hay, el precio negociado del catalogo
        select id, precio, fecha into v_prev from precio_historial
          where proveedor_nit = v_nit and articulo_clave = v_clave and fecha <= v_fecha order by fecha desc, id desc limit 1;
        v_ant := null; v_fant := null; v_base := null;
        if found then v_ant := v_prev.precio; v_fant := v_prev.fecha; v_base := 'ultimo';
        elsif v_cod is not null then
          select c.precio_negociado into v_ant from catalogo_compras c join proveedores p on p.id = c.id_proveedor
            where upper(btrim(c.codigo_barras)) = upper(v_cod) and regexp_replace(p.nit, '\D', '', 'g') = v_nit and c.precio_negociado > 0 order by c.prioridad nulls last limit 1;
          if v_ant is not null then v_base := 'negociado'; end if;
        end if;
        if p_aplicar then
          insert into precio_historial (proveedor_nit, proveedor_nombre, articulo_clave, articulo_texto, codigo, unidad, precio, cantidad, fecha, fuente, factura_ref, factura_cufe, pedido_numero, creado_por)
          values (v_nit, v_nom, v_clave, v_art, v_cod, v_uni, v_precio, v_cant, v_fecha, p_fuente, v_ref, v_cufe, v_ped, v_quien) returning id into v_hid;
        end if;
        if v_ant is not null and v_ant > 0 and v_precio <> v_ant then
          v_pct := round((v_precio - v_ant) / v_ant * 100, 2);
          if abs(v_pct) >= v_umbral then
            v_vars := v_vars + 1;
            v_var := jsonb_build_object('anterior', v_ant, 'nuevo', v_precio, 'pct', v_pct, 'base', v_base, 'fecha_anterior', v_fant);
            if p_aplicar then
              insert into precio_variacion (historial_id, proveedor_nit, proveedor_nombre, articulo_clave, articulo_texto, precio_anterior, fecha_anterior, precio_nuevo, fecha_nueva, variacion_pct, base, factura_ref)
              values (v_hid, v_nit, v_nom, v_clave, v_art, v_ant, v_fant, v_precio, v_fecha, v_pct, v_base, v_ref);
            end if;
          end if;
        end if;
      end if;
    else
      v_est := 'error'; v_errs := v_errs + 1;
    end if;
    v_filas := v_filas || jsonb_build_object('n', v_n, 'estado', v_est, 'variacion', v_var, 'errores', to_jsonb(v_err));
  end loop;

  return jsonb_build_object('aplicado', p_aplicar, 'umbral_pct', v_umbral,
    'resumen', jsonb_build_object('lineas', jsonb_array_length(p_lineas), 'registrados', v_reg, 'duplicados', v_dup, 'errores', v_errs, 'variaciones', v_vars), 'filas', v_filas);
end
$fn$;

-- ---------- resumen diario por correo ----------
create or replace function precio_resumen_diario(p_forzar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hoy date := (timezone('America/Bogota', now()))::date;
  v_hora int := extract(hour from timezone('America/Bogota', now()))::int;
  v_umbral text := coalesce(precio_cfg('umbral_pct'), '5');
  v_dest text[]; v_d text; v_ids bigint[]; v_n int; v_provs int; v_cuerpo text; v_asunto text; v_lineas int := 0; v_max int := 150; v_prov text := null; v_r record; v_cids bigint[] := '{}'; v_cid bigint;
begin
  if not precio_puede() then raise exception 'Sin permiso.' using errcode = '42501'; end if;
  if not p_forzar then
    if coalesce(precio_cfg('resumen_activo'), 'true') <> 'true' then return jsonb_build_object('enviado', false, 'motivo', 'resumen desactivado'); end if;
    if v_hora < coalesce(nullif(precio_cfg('resumen_hora'), '')::int, 17) then return jsonb_build_object('enviado', false, 'motivo', 'aun no es la hora del resumen'); end if;
    if precio_cfg('ultimo_resumen') = v_hoy::text then return jsonb_build_object('enviado', false, 'motivo', 'el resumen de hoy ya se envio'); end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('precio_resumen_diario'));
  select array_agg(id order by id) into v_ids from precio_variacion where correo_en is null and estado <> 'descartada';
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n = 0 then return jsonb_build_object('enviado', false, 'motivo', 'sin variaciones nuevas'); end if;
  select array_agg(trim(x)) into v_dest from unnest(string_to_array(coalesce(precio_cfg('correos'), ''), ',')) x where trim(x) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  if v_dest is null or cardinality(v_dest) = 0 then return jsonb_build_object('enviado', false, 'motivo', 'no hay correo configurado', 'variaciones', v_n); end if;
  select count(distinct proveedor_nit) into v_provs from precio_variacion where id = any (v_ids);
  v_asunto := format('Variacion de precios: %s cambio(s) en %s proveedor(es) - %s', v_n, v_provs, to_char(v_hoy, 'DD/MM/YYYY'));
  v_cuerpo := format(E'Variacion de precios de proveedores - %s\n%s cambio(s) de precio de %s proveedor(es) (umbral: %s %%).\n', to_char(v_hoy, 'DD/MM/YYYY'), v_n, v_provs, v_umbral);
  for v_r in select * from precio_variacion where id = any (v_ids) order by proveedor_nombre nulls last, proveedor_nit, abs(variacion_pct) desc, id loop
    exit when v_lineas >= v_max;
    if v_prov is distinct from v_r.proveedor_nit then
      v_cuerpo := v_cuerpo || format(E'\n%s (NIT %s)\n', coalesce(v_r.proveedor_nombre, 'Proveedor'), imp_mask(v_r.proveedor_nit)); v_prov := v_r.proveedor_nit;
    end if;
    v_cuerpo := v_cuerpo || format(E'  %s %s: %s -> %s (%s)%s%s\n', case when v_r.variacion_pct > 0 then 'SUBE' else 'BAJA' end, v_r.articulo_texto, precio_fmt(v_r.precio_anterior), precio_fmt(v_r.precio_nuevo),
      precio_fmt_pct(v_r.variacion_pct), case when v_r.base = 'negociado' then ' - contra el precio negociado' when v_r.fecha_anterior is not null then ' - antes el ' || to_char(v_r.fecha_anterior, 'DD/MM/YYYY') else '' end,
      case when v_r.factura_ref is not null then ' - factura ' || v_r.factura_ref else '' end);
    v_lineas := v_lineas + 1;
  end loop;
  if v_n > v_lineas then v_cuerpo := v_cuerpo || format(E'\n... y %s cambio(s) mas: revisalos en el modulo Precios del Banco de Facturas.\n', v_n - v_lineas); end if;
  v_cuerpo := v_cuerpo || E'\nRevisa y marca cada cambio en el modulo Precios del Banco de Facturas.\n\n--- Banco de Facturas';
  foreach v_d in array v_dest loop
    select correo_id into v_cid from correo_encolar(v_d, v_asunto, v_cuerpo);
    v_cids := array_append(v_cids, v_cid);
  end loop;
  update precio_variacion set correo_en = now() where id = any (v_ids);
  update precio_config set valor = v_hoy::text, actualizado_en = now() where clave = 'ultimo_resumen';
  return jsonb_build_object('enviado', true, 'variaciones', v_n, 'proveedores', v_provs, 'destinatarios', cardinality(v_dest), 'correo_ids', to_jsonb(v_cids));
end
$fn$;

-- ---------- revisar una variacion ----------
create or replace function precio_revisar(p_id bigint, p_estado text, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_quien text;
begin
  if mi_rol() not in ('admin', 'pagos') then raise exception 'Sin permiso.' using errcode = '42501'; end if;
  if p_estado not in ('nueva', 'revisada', 'descartada') then raise exception 'Estado desconocido: %', p_estado using errcode = '22023'; end if;
  select coalesce(nombre, 'sin nombre') into v_quien from perfiles where user_id = auth.uid();
  update precio_variacion set estado = p_estado, nota = coalesce(nullif(btrim(p_nota), ''), nota),
         revisada_por = case when p_estado = 'nueva' then null else v_quien end, revisada_en = case when p_estado = 'nueva' then null else now() end
   where id = p_id;
  if not found then raise exception 'No existe esa variacion.' using errcode = '02000'; end if;
end
$fn$;

-- ---------- cambiar la configuracion (solo admin) ----------
create or replace function precio_config_guardar(p_clave text, p_valor text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v text := btrim(coalesce(p_valor, ''));
begin
  if mi_rol() <> 'admin' then raise exception 'Solo el administrador puede cambiar esto.' using errcode = '42501'; end if;
  if p_clave = 'umbral_pct' then
    if v !~ '^[0-9]+([.,][0-9]+)?$' or replace(v, ',', '.')::numeric > 100 then raise exception 'El umbral debe ser un numero entre 0 y 100.' using errcode = '22023'; end if;
    v := replace(v, ',', '.');
  elsif p_clave = 'correos' then
    if v = '' then null;
    elsif exists (select 1 from unnest(string_to_array(v, ',')) x where trim(x) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'Alguno de los correos no es valido.' using errcode = '22023'; end if;
    v := (select string_agg(trim(x), ',') from unnest(string_to_array(v, ',')) x);
  elsif p_clave = 'resumen_hora' then
    if v !~ '^[0-9]{1,2}$' or v::int > 23 then raise exception 'La hora debe estar entre 0 y 23.' using errcode = '22023'; end if;
  elsif p_clave = 'resumen_activo' then
    if v not in ('true', 'false') then raise exception 'Debe ser true o false.' using errcode = '22023'; end if;
  else raise exception 'Esa configuracion no se puede cambiar.' using errcode = '22023';
  end if;
  update precio_config set valor = coalesce(v, ''), actualizado_en = now() where clave = p_clave;
end
$fn$;

do $g$ begin
  execute 'revoke all on function precio_registrar(jsonb, text, boolean) from public, anon';
  execute 'revoke all on function precio_resumen_diario(boolean) from public, anon';
  execute 'revoke all on function precio_revisar(bigint, text, text) from public, anon';
  execute 'revoke all on function precio_config_guardar(text, text) from public, anon';
  execute 'grant execute on function precio_registrar(jsonb, text, boolean) to authenticated, service_role';
  execute 'grant execute on function precio_resumen_diario(boolean) to authenticated, service_role';
  execute 'grant execute on function precio_revisar(bigint, text, text) to authenticated';
  execute 'grant execute on function precio_config_guardar(text, text) to authenticated';
end $g$;
