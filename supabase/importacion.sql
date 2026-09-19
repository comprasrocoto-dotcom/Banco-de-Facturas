-- ============================================================
--  IMPORTACION DE BASES (maestros por CSV)  -  19/09/2026
--  Alimenta proveedores, productos (articulos), conversiones (unidades_medida), maximos/minimos y catalogo de compras
--  desde un CSV, con VALIDACION PREVIA y SIN DUPLICAR.
--
--  SOLO AGREGA: 1 tabla de bitacora (importacion_lote) + funciones nuevas. No cambia ninguna tabla, columna ni politica existente.
--  NO hay tabla de conversiones nueva: "conversiones" escribe en unidades_medida (la que ya existia).
--
--  importar_maestro(tipo, filas, aplicar, archivo):
--    aplicar = false  ->  VISTA PREVIA: dice, fila por fila, si es NUEVA / ACTUALIZA (con que cambia) / IGUAL / ERROR. No escribe nada.
--    aplicar = true   ->  hace exactamente lo mismo y ESCRIBE lo que no tiene error (las filas con error se omiten y se cuentan).
--  Solo el administrador. Todo o nada por llamada (una transaccion). Un candado evita dos importaciones al tiempo.
--  Nunca borra: lo que no venga en el archivo queda como esta. Una celda vacia NO borra lo que ya habia.
-- ============================================================

-- ---------- bitacora ----------
create table if not exists importacion_lote (
  id              bigserial primary key,
  tipo            text not null,
  archivo         text,
  usuario         uuid,
  usuario_nombre  text,
  total           int not null default 0,
  nuevos          int not null default 0,
  actualizados    int not null default 0,
  iguales         int not null default 0,
  omitidos        int not null default 0,
  creado_en       timestamptz not null default now(),
  detalle         jsonb
);
alter table importacion_lote enable row level security;
drop policy if exists importacion_lote_ver on importacion_lote;
create policy importacion_lote_ver on importacion_lote for select to authenticated using (mi_rol() = 'admin');
-- (sin politicas de escritura: solo la funcion importar_maestro, que es security definer, escribe aqui)

-- ---------- utilidades ----------
-- texto de una llave del JSON, ya recortado; vacio = null
create or replace function imp_txt(r jsonb, k text) returns text language sql immutable as
$$ select nullif(btrim(r ->> k), '') $$;

-- numero valido? (acepta coma o punto decimal simple; vacio es valido = "no viene")
create or replace function imp_num_ok(t text) returns boolean language sql immutable as
$$ select t is null or btrim(t) = '' or replace(btrim(t), ',', '.') ~ '^-?[0-9]+(\.[0-9]+)?$' $$;
create or replace function imp_num(t text) returns numeric language sql immutable as
$$ select nullif(replace(btrim(t), ',', '.'), '')::numeric $$;

-- arregla el texto "mojibake" (PRODUCCIÃ“N -> PRODUCCIÓN) que trae parte de maximos_minimos; si no es mojibake lo deja igual
create or replace function imp_arreglar(t text) returns text language plpgsql immutable as
$$
begin
  if t is null or t !~ '[ÃÂ]' then return t; end if;
  begin
    return convert_from(convert_to(t, 'WIN1252'), 'UTF8');
  exception when others then
    return t;
  end;
end
$$;

-- mayusculas, sin tildes, espacios simples
create or replace function imp_norm(t text) returns text language sql immutable as
$$ select btrim(regexp_replace(translate(upper(coalesce(t, '')), 'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛ', 'AEIOUUNAEIOUAEIOU'), '\s+', ' ', 'g')) $$;

-- llave de comparacion de NOMBRES (articulo, almacen): sin tildes, sin signos, sin espacios y con el mojibake arreglado.
-- Es la misma idea que usa la pagina (Conversiones.claveNombre) para casar el articulo con su maximo/minimo.
create or replace function imp_clave(t text) returns text language sql immutable as
$$ select regexp_replace(imp_norm(imp_arreglar(t)), '[^A-Z0-9]', '', 'g') $$;

-- llave de una unidad de compra: sin espacios y con "*" = "X" ("CAJA*12UND" = "CAJAX12UND")
create or replace function imp_formato(t text) returns text language sql immutable as
$$ select translate(regexp_replace(upper(btrim(coalesce(t, ''))), '\s+', '', 'g'), '*×', 'XX') $$;

create or replace function imp_mask(nit text) returns text language sql immutable as
$$ select case when nit is null or nit = '' then '—' else '******' || right(regexp_replace(nit, '\D', '', 'g'), 3) end $$;

-- ---------- la importacion ----------
create or replace function importar_maestro(p_tipo text, p_filas jsonb, p_aplicar boolean default false, p_archivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_r jsonb; v_i bigint; v_n int;
  v_err text[]; v_av text[]; v_cam text[]; v_est text;
  v_total int := 0; v_nuevos int := 0; v_act int := 0; v_ig int := 0; v_errs int := 0; v_avs int := 0;
  -- comunes
  v_k text; v_prev int; v_id bigint;
  -- proveedores
  v_nit text; v_rz text; v_nc text; v_t1 text; v_t2 text; v_co text; v_as text; v_ip text; v_p proveedores%rowtype;
  -- articulos
  v_cb text; v_com text; v_hio text; v_ref text; v_sf text; v_uh text; v_uc text; v_a articulos%rowtype; v_otro text;
  -- conversiones
  v_fmt text; v_med numeric; v_uni text; v_u unidades_medida%rowtype; v_fam text;
  -- maximos_minimos
  v_alm text; v_art text; v_sub text; v_min numeric; v_max numeric; v_var numeric; v_mar numeric; v_m maximos_minimos%rowtype; v_almc text;
  -- catalogo
  v_prov proveedores%rowtype; v_pre numeric; v_pri int; v_es text; v_c catalogo_compras%rowtype;
  v_resumen jsonb; v_filas jsonb; v_nombre text;
begin
  if mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede importar bases.' using errcode = '42501';
  end if;
  if p_tipo not in ('proveedores', 'productos', 'conversiones', 'maximos_minimos', 'catalogo') then
    raise exception 'Tipo de base desconocido: %', p_tipo using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Las filas deben venir como una lista.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 5000 then
    raise exception 'Máximo 5.000 filas por archivo (trae %). Divídelo en partes.', jsonb_array_length(p_filas) using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('importar_maestro'));     -- una importacion a la vez

  create temp table if not exists _imp_res (n int, estado text, cambios text[], errores text[], avisos text[]) on commit drop;
  create temp table if not exists _imp_vistos (k text primary key, n int) on commit drop;
  truncate _imp_res; truncate _imp_vistos;

  -- fotos de lo que ya existe (con las llaves de comparacion ya calculadas) para no recalcular fila por fila
  if p_tipo = 'maximos_minimos' then
    create temp table if not exists _imp_mm (id bigint, ka text, kr text, ks text, almacen text) on commit drop;
    truncate _imp_mm;
    insert into _imp_mm select id, imp_clave(almacen), imp_clave(articulo), imp_norm(subarticulo), almacen from maximos_minimos;
    create index if not exists _imp_mm_i on _imp_mm (ka, kr, ks);
  end if;
  if p_tipo in ('productos', 'maximos_minimos', 'catalogo') then
    create temp table if not exists _imp_art (id bigint, kc text, kn1 text, kn2 text, codigo text) on commit drop;
    truncate _imp_art;
    insert into _imp_art select id, upper(btrim(codigo_barras)), imp_clave(articulo_hiopos), imp_clave(articulo_comercial), codigo_barras from articulos;
  end if;

  for v_r, v_i in select value, ordinality from jsonb_array_elements(p_filas) with ordinality loop
    v_err := '{}'; v_av := '{}'; v_cam := '{}'; v_est := null; v_total := v_total + 1;
    v_n := case when (v_r ->> 'n') ~ '^[0-9]+$' then (v_r ->> 'n')::int else v_i::int end;

    -- ========================= PROVEEDORES (llave: NIT solo digitos) =========================
    if p_tipo = 'proveedores' then
      v_nit := regexp_replace(coalesce(v_r ->> 'nit', ''), '\D', '', 'g');
      v_rz := imp_txt(v_r, 'razon_social'); v_nc := imp_txt(v_r, 'nombre_comercial'); v_t1 := imp_txt(v_r, 'telefono1'); v_t2 := imp_txt(v_r, 'telefono2');
      v_co := imp_txt(v_r, 'correo'); v_as := imp_txt(v_r, 'asesor'); v_ip := imp_txt(v_r, 'id_planilla');
      if v_nit = '' then v_err := array_append(v_err, 'falta el NIT'::text);
      elsif length(v_nit) < 5 or length(v_nit) > 15 then v_err := array_append(v_err, 'el NIT no parece válido (debe tener entre 5 y 15 dígitos)'::text); end if;
      if v_rz is null and v_nc is null then v_err := array_append(v_err, 'falta la razón social'::text); end if;
      if v_co is not null and v_co !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_err := array_append(v_err, 'el correo no es válido'::text); end if;
      if cardinality(v_err) = 0 then
        v_k := v_nit; select n into v_prev from _imp_vistos where k = v_k;
        if v_prev is not null then v_err := v_err || format('repetida en el archivo (misma que la fila %s)', v_prev);
        else
          insert into _imp_vistos values (v_k, v_n);
          select * into v_p from proveedores where regexp_replace(nit, '\D', '', 'g') = v_nit limit 1;
          if not found then
            v_est := 'nuevo';
            select razon_social into v_otro from proveedores where imp_clave(razon_social) = imp_clave(coalesce(v_rz, v_nc)) and regexp_replace(nit, '\D', '', 'g') <> v_nit limit 1;
            if v_otro is not null then v_av := v_av || ('ya existe un proveedor con ese nombre pero otro NIT: ' || v_otro); end if;
            if p_aplicar then
              insert into proveedores (nit, razon_social, nombre_comercial, telefono1, telefono2, correo, asesor, id_planilla) values (v_nit, v_rz, v_nc, v_t1, v_t2, v_co, v_as, v_ip);
            end if;
          else
            if v_rz is not null and v_rz is distinct from v_p.razon_social then v_cam := v_cam || format('razón social: %s → %s', coalesce(v_p.razon_social, '—'), v_rz); end if;
            if v_nc is not null and v_nc is distinct from v_p.nombre_comercial then v_cam := v_cam || format('nombre comercial: %s → %s', coalesce(v_p.nombre_comercial, '—'), v_nc); end if;
            if v_t1 is not null and v_t1 is distinct from v_p.telefono1 then v_cam := v_cam || format('teléfono 1: %s → %s', coalesce(v_p.telefono1, '—'), v_t1); end if;
            if v_t2 is not null and v_t2 is distinct from v_p.telefono2 then v_cam := v_cam || format('teléfono 2: %s → %s', coalesce(v_p.telefono2, '—'), v_t2); end if;
            if v_co is not null and v_co is distinct from v_p.correo then v_cam := v_cam || format('correo: %s → %s', coalesce(v_p.correo, '—'), v_co); end if;
            if v_as is not null and v_as is distinct from v_p.asesor then v_cam := v_cam || format('asesor: %s → %s', coalesce(v_p.asesor, '—'), v_as); end if;
            if v_ip is not null and v_ip is distinct from v_p.id_planilla then v_cam := v_cam || format('id planilla: %s → %s', coalesce(v_p.id_planilla, '—'), v_ip); end if;
            v_est := case when cardinality(v_cam) = 0 then 'igual' else 'actualiza' end;
            if p_aplicar and v_est = 'actualiza' then
              update proveedores set razon_social = coalesce(v_rz, razon_social), nombre_comercial = coalesce(v_nc, nombre_comercial), telefono1 = coalesce(v_t1, telefono1),
                     telefono2 = coalesce(v_t2, telefono2), correo = coalesce(v_co, correo), asesor = coalesce(v_as, asesor), id_planilla = coalesce(v_ip, id_planilla) where id = v_p.id;
            end if;
          end if;
        end if;
      end if;

    -- ========================= PRODUCTOS (articulos; llave: codigo de barras) =========================
    elsif p_tipo = 'productos' then
      v_cb := imp_txt(v_r, 'codigo_barras');
      if v_cb ~ '^[0-9]+\.0+$' then v_cb := split_part(v_cb, '.', 1); end if;              -- Excel: 1728.0 -> 1728
      v_com := imp_txt(v_r, 'articulo_comercial'); v_hio := imp_txt(v_r, 'articulo_hiopos'); v_ref := imp_txt(v_r, 'codigo_referencia');
      v_sf := imp_txt(v_r, 'subfamilia'); v_uh := imp_txt(v_r, 'unimedida_hiopos'); v_uc := imp_txt(v_r, 'unimedida_compra');
      if v_cb is null then v_err := array_append(v_err, 'falta el código'::text);
      elsif v_cb !~ '^[A-Za-z0-9._-]+$' then v_err := array_append(v_err, 'el código solo puede tener letras, números, punto, guion y guion bajo'::text); end if;
      if v_com is null and v_hio is null then v_err := array_append(v_err, 'falta el nombre del artículo'::text); end if;
      if cardinality(v_err) = 0 then
        v_k := upper(v_cb); select n into v_prev from _imp_vistos where k = v_k;
        if v_prev is not null then v_err := v_err || format('repetida en el archivo (mismo código que la fila %s)', v_prev);
        else
          insert into _imp_vistos values (v_k, v_n);
          select * into v_a from articulos where upper(btrim(codigo_barras)) = v_k limit 1;
          if not found then
            v_est := 'nuevo';
            select codigo into v_otro from _imp_art where (kn1 <> '' and kn1 in (imp_clave(v_hio), imp_clave(v_com))) or (kn2 <> '' and kn2 in (imp_clave(v_hio), imp_clave(v_com))) limit 1;
            if v_otro is not null then v_av := v_av || ('ya existe un artículo con ese nombre (código ' || v_otro || ')'); end if;
            if p_aplicar then
              insert into articulos (codigo_barras, codigo_referencia, subfamilia, articulo_hiopos, unimedida_hiopos, articulo_comercial, unimedida_compra)
              values (v_cb, v_ref, v_sf, v_hio, v_uh, coalesce(v_com, v_hio), v_uc);
            end if;
          else
            if v_com is not null and v_com is distinct from v_a.articulo_comercial then v_cam := v_cam || format('nombre comercial: %s → %s', coalesce(v_a.articulo_comercial, '—'), v_com); end if;
            if v_hio is not null and v_hio is distinct from v_a.articulo_hiopos then v_cam := v_cam || format('nombre Hiopos: %s → %s', coalesce(v_a.articulo_hiopos, '—'), v_hio); end if;
            if v_ref is not null and v_ref is distinct from v_a.codigo_referencia then v_cam := v_cam || format('referencia: %s → %s', coalesce(v_a.codigo_referencia, '—'), v_ref); end if;
            if v_sf is not null and v_sf is distinct from v_a.subfamilia then v_cam := v_cam || format('subfamilia: %s → %s', coalesce(v_a.subfamilia, '—'), v_sf); end if;
            if v_uh is not null and v_uh is distinct from v_a.unimedida_hiopos then v_cam := v_cam || format('unidad Hiopos: %s → %s', coalesce(v_a.unimedida_hiopos, '—'), v_uh); end if;
            if v_uc is not null and v_uc is distinct from v_a.unimedida_compra then v_cam := v_cam || format('unidad de compra: %s → %s', coalesce(v_a.unimedida_compra, '—'), v_uc); end if;
            v_est := case when cardinality(v_cam) = 0 then 'igual' else 'actualiza' end;
            if p_aplicar and v_est = 'actualiza' then
              update articulos set articulo_comercial = coalesce(v_com, articulo_comercial), articulo_hiopos = coalesce(v_hio, articulo_hiopos), codigo_referencia = coalesce(v_ref, codigo_referencia),
                     subfamilia = coalesce(v_sf, subfamilia), unimedida_hiopos = coalesce(v_uh, unimedida_hiopos), unimedida_compra = coalesce(v_uc, unimedida_compra) where id = v_a.id;
            end if;
          end if;
        end if;
      end if;

    -- ========================= CONVERSIONES (unidades_medida; llave: la unidad de compra) =========================
    elsif p_tipo = 'conversiones' then
      v_fmt := imp_txt(v_r, 'formato'); v_uni := lower(imp_txt(v_r, 'unidad'));
      if v_fmt is null then v_err := array_append(v_err, 'falta la unidad de compra (presentación)'::text); end if;
      if not imp_num_ok(v_r ->> 'medida') then v_err := array_append(v_err, 'la cantidad no es un número'::text); v_med := null;
      else
        v_med := imp_num(v_r ->> 'medida');
        if v_med is null then v_err := array_append(v_err, 'falta la cantidad'::text); elsif v_med <= 0 then v_err := array_append(v_err, 'la cantidad debe ser mayor que 0'::text); elsif v_med > 10000000 then v_err := array_append(v_err, 'la cantidad es absurda (más de 10 millones)'::text); end if;
      end if;
      if v_uni is null then v_err := array_append(v_err, 'falta la unidad (g, kg, lb, oz, ml, l, uds o copa)'::text);
      else
        -- la unidad tiene que ser una medible del catalogo (no un empaque) o "copa"
        select c.familia into v_fam from unidad_alias a join unidad_catalogo c on c.canon = a.canon where lower(a.alias) = v_uni and a.activo and c.activo limit 1;
        if v_fam is null and v_uni <> 'copa' then v_err := v_err || format('la unidad "%s" no se reconoce (usa g, kg, lb, oz, ml, l, uds o copa)', v_uni);
        elsif v_fam = 'empaque' then v_err := v_err || format('"%s" es un empaque, no una medida: di cuántas unidades, gramos o mililitros trae', v_uni); end if;
      end if;
      if cardinality(v_err) = 0 then
        v_k := imp_formato(v_fmt); select n into v_prev from _imp_vistos where k = v_k;
        if v_prev is not null then v_err := v_err || format('repetida en el archivo (misma unidad de compra que la fila %s)', v_prev);
        else
          insert into _imp_vistos values (v_k, v_n);
          select * into v_u from unidades_medida where imp_formato(formato) = v_k limit 1;
          if not found then
            v_est := 'nuevo';
            if p_aplicar then insert into unidades_medida (formato, medida, unidad) values (upper(regexp_replace(btrim(v_fmt), '\s+', ' ', 'g')), v_med, v_uni); end if;
          else
            if v_u.medida is distinct from v_med then v_cam := v_cam || format('cantidad: %s → %s', coalesce(v_u.medida::text, '—'), v_med); end if;
            if lower(coalesce(v_u.unidad, '')) is distinct from v_uni then v_cam := v_cam || format('unidad: %s → %s', coalesce(v_u.unidad, '—'), v_uni); end if;
            v_est := case when cardinality(v_cam) = 0 then 'igual' else 'actualiza' end;
            if v_est = 'actualiza' then v_av := array_append(v_av, 'cambia una conversión que ya existía'::text); end if;
            if p_aplicar and v_est = 'actualiza' then update unidades_medida set medida = v_med, unidad = v_uni where id = v_u.id; end if;
          end if;
        end if;
      end if;

    -- ========================= MAXIMOS Y MINIMOS (llave: almacen + articulo + unidad de inventario) =========================
    elsif p_tipo = 'maximos_minimos' then
      v_alm := imp_txt(v_r, 'almacen'); v_art := imp_txt(v_r, 'articulo'); v_sub := imp_txt(v_r, 'subarticulo');
      if v_alm is null then v_err := array_append(v_err, 'falta el almacén'::text); end if;
      if v_art is null then v_err := array_append(v_err, 'falta el artículo'::text); end if;
      if v_sub is null then v_err := array_append(v_err, 'falta la unidad de inventario (GRAMOS, UNIDADES, ONZA, COPA...)'::text); end if;
      if not imp_num_ok(v_r ->> 'minimo') then v_err := array_append(v_err, 'el mínimo no es un número'::text); end if;
      if not imp_num_ok(v_r ->> 'maximo') then v_err := array_append(v_err, 'el máximo no es un número'::text); end if;
      if not imp_num_ok(v_r ->> 'variacion') then v_err := array_append(v_err, 'la variación no es un número'::text); end if;
      if not imp_num_ok(v_r ->> 'margen') then v_err := array_append(v_err, 'el margen no es un número'::text); end if;
      if cardinality(v_err) = 0 then
        v_min := imp_num(v_r ->> 'minimo'); v_max := imp_num(v_r ->> 'maximo'); v_var := imp_num(v_r ->> 'variacion'); v_mar := imp_num(v_r ->> 'margen');
        if v_min is null and v_max is null then v_err := array_append(v_err, 'no trae ni mínimo ni máximo'::text);
        elsif v_min < 0 or v_max < 0 then v_err := array_append(v_err, 'el mínimo y el máximo no pueden ser negativos'::text);
        elsif v_min is not null and v_max is not null and v_min > v_max then v_err := v_err || format('el mínimo (%s) es mayor que el máximo (%s)', v_min, v_max); end if;
      end if;
      if cardinality(v_err) = 0 then
        v_k := imp_clave(v_alm) || '|' || imp_clave(v_art) || '|' || imp_norm(v_sub); select n into v_prev from _imp_vistos where k = v_k;
        if v_prev is not null then v_err := v_err || format('repetida en el archivo (mismo almacén, artículo y unidad que la fila %s)', v_prev);
        else
          insert into _imp_vistos values (v_k, v_n);
          -- el almacen: si ya existe con otra ortografia se usa la que ya esta (para no crear "almacenes" duplicados)
          select almacen into v_almc from _imp_mm where ka = imp_clave(v_alm) limit 1;
          if v_almc is null then v_av := v_av || format('almacén nuevo: "%s" (no existe en la base; revisa que no sea un error de digitación)', v_alm); v_almc := v_alm; end if;
          if not exists (select 1 from _imp_art where kn1 = imp_clave(v_art) or kn2 = imp_clave(v_art)) then v_av := array_append(v_av, 'el artículo no está en Productos: no se verá en el pedido'::text); end if;
          if not exists (select 1 from _imp_mm where ks = imp_norm(v_sub)) and imp_norm(v_sub) not in ('GRAMOS', 'UNIDADES', 'ONZA', 'COPA') then v_av := v_av || format('unidad de inventario nueva: "%s"', v_sub); end if;
          select id into v_id from _imp_mm where ka = imp_clave(v_alm) and kr = imp_clave(v_art) and ks = imp_norm(v_sub) limit 1;
          if v_id is null then
            v_est := 'nuevo';
            if p_aplicar then insert into maximos_minimos (almacen, articulo, subarticulo, variacion, margen, minimo, maximo) values (v_almc, v_art, upper(btrim(v_sub)), v_var, v_mar, v_min, v_max); end if;
          else
            select * into v_m from maximos_minimos where id = v_id;
            if v_min is not null and v_min is distinct from v_m.minimo then v_cam := v_cam || format('mínimo: %s → %s', coalesce(v_m.minimo::text, '—'), v_min); end if;
            if v_max is not null and v_max is distinct from v_m.maximo then v_cam := v_cam || format('máximo: %s → %s', coalesce(v_m.maximo::text, '—'), v_max); end if;
            if v_var is not null and v_var is distinct from v_m.variacion then v_cam := v_cam || format('variación: %s → %s', coalesce(v_m.variacion::text, '—'), v_var); end if;
            if v_mar is not null and v_mar is distinct from v_m.margen then v_cam := v_cam || format('margen: %s → %s', coalesce(v_m.margen::text, '—'), v_mar); end if;
            v_est := case when cardinality(v_cam) = 0 then 'igual' else 'actualiza' end;
            if p_aplicar and v_est = 'actualiza' then
              update maximos_minimos set minimo = coalesce(v_min, minimo), maximo = coalesce(v_max, maximo), variacion = coalesce(v_var, variacion), margen = coalesce(v_mar, margen) where id = v_id;
            end if;
          end if;
        end if;
      end if;

    -- ========================= CATALOGO DE COMPRAS (llave: articulo + proveedor) =========================
    elsif p_tipo = 'catalogo' then
      v_cb := imp_txt(v_r, 'codigo_barras'); v_nit := regexp_replace(coalesce(v_r ->> 'nit_proveedor', ''), '\D', '', 'g'); v_es := imp_txt(v_r, 'estado');
      if v_cb ~ '^[0-9]+\.0+$' then v_cb := split_part(v_cb, '.', 1); end if;
      if v_cb is null then v_err := array_append(v_err, 'falta el código del artículo'::text); end if;
      if v_nit = '' then v_err := array_append(v_err, 'falta el NIT del proveedor'::text); end if;
      if not imp_num_ok(v_r ->> 'precio_negociado') then v_err := array_append(v_err, 'el precio no es un número'::text); end if;
      if (v_r ->> 'prioridad') is not null and btrim(v_r ->> 'prioridad') <> '' and (v_r ->> 'prioridad') !~ '^[0-9]+$' then v_err := array_append(v_err, 'la prioridad debe ser un número entero (1 = primera opción)'::text); end if;
      if cardinality(v_err) = 0 then
        v_pre := imp_num(v_r ->> 'precio_negociado'); v_pri := nullif(btrim(v_r ->> 'prioridad'), '')::int;
        if v_pre is not null and v_pre < 0 then v_err := array_append(v_err, 'el precio no puede ser negativo'::text); end if;
        if v_pri is not null and v_pri < 1 then v_err := array_append(v_err, 'la prioridad debe ser 1 o más'::text); end if;
      end if;
      if cardinality(v_err) = 0 then
        select * into v_prov from proveedores where regexp_replace(nit, '\D', '', 'g') = v_nit limit 1;
        if not found then v_err := v_err || format('el proveedor con NIT %s no existe (cárgalo primero en Proveedores)', imp_mask(v_nit)); end if;
        if not exists (select 1 from _imp_art where kc = upper(v_cb)) then v_err := v_err || format('el artículo %s no existe (cárgalo primero en Productos)', v_cb); end if;
      end if;
      if cardinality(v_err) = 0 then
        v_k := upper(v_cb) || '|' || v_prov.id; select n into v_prev from _imp_vistos where k = v_k;
        if v_prev is not null then v_err := v_err || format('repetida en el archivo (mismo artículo y proveedor que la fila %s)', v_prev);
        else
          insert into _imp_vistos values (v_k, v_n);
          if v_es is not null and v_es <> 'Aprobado' then v_av := v_av || format('el estado "%s" no es "Aprobado"', v_es); end if;
          select * into v_c from catalogo_compras where upper(btrim(codigo_barras)) = upper(v_cb) and id_proveedor = v_prov.id limit 1;
          if not found then
            v_est := 'nuevo';
            if p_aplicar then insert into catalogo_compras (codigo_barras, id_proveedor, prioridad, precio_negociado, estado) values (v_cb, v_prov.id, coalesce(v_pri, 1), v_pre, coalesce(v_es, 'Aprobado')); end if;
          else
            if v_pre is not null and v_pre is distinct from v_c.precio_negociado then v_cam := v_cam || format('precio: %s → %s', coalesce(v_c.precio_negociado::text, '—'), v_pre); end if;
            if v_pri is not null and v_pri is distinct from v_c.prioridad then v_cam := v_cam || format('prioridad: %s → %s', coalesce(v_c.prioridad::text, '—'), v_pri); end if;
            if v_es is not null and v_es is distinct from v_c.estado then v_cam := v_cam || format('estado: %s → %s', coalesce(v_c.estado, '—'), v_es); end if;
            v_est := case when cardinality(v_cam) = 0 then 'igual' else 'actualiza' end;
            if p_aplicar and v_est = 'actualiza' then update catalogo_compras set precio_negociado = coalesce(v_pre, precio_negociado), prioridad = coalesce(v_pri, prioridad), estado = coalesce(v_es, estado) where id = v_c.id; end if;
          end if;
        end if;
      end if;
    end if;

    if cardinality(v_err) > 0 then v_est := 'error'; end if;
    if v_est = 'nuevo' then v_nuevos := v_nuevos + 1; elsif v_est = 'actualiza' then v_act := v_act + 1; elsif v_est = 'igual' then v_ig := v_ig + 1; else v_errs := v_errs + 1; end if;
    if cardinality(v_av) > 0 then v_avs := v_avs + 1; end if;
    insert into _imp_res values (v_n, v_est, v_cam, v_err, v_av);
  end loop;

  v_resumen := jsonb_build_object('total', v_total, 'nuevos', v_nuevos, 'actualizados', v_act, 'iguales', v_ig, 'errores', v_errs, 'con_avisos', v_avs);
  select coalesce(jsonb_agg(jsonb_build_object('n', n, 'estado', estado, 'cambios', to_jsonb(cambios), 'errores', to_jsonb(errores), 'avisos', to_jsonb(avisos)) order by n), '[]'::jsonb) into v_filas from _imp_res;

  if p_aplicar then
    select nombre into v_nombre from perfiles where user_id = auth.uid();
    insert into importacion_lote (tipo, archivo, usuario, usuario_nombre, total, nuevos, actualizados, iguales, omitidos, detalle)
    values (p_tipo, left(p_archivo, 200), auth.uid(), v_nombre, v_total, v_nuevos, v_act, v_ig, v_errs, v_resumen);
  end if;

  return jsonb_build_object('tipo', p_tipo, 'aplicado', p_aplicar, 'resumen', v_resumen, 'filas', v_filas);
end
$fn$;

revoke all on function importar_maestro(text, jsonb, boolean, text) from public;
revoke all on function importar_maestro(text, jsonb, boolean, text) from anon;
grant execute on function importar_maestro(text, jsonb, boolean, text) to authenticated;
