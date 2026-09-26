-- ============================================================
-- PROVEEDORES POR MARCA  (26/09/2026)   MARCA -> PROVEEDORES -> PRODUCTOS
-- ADITIVO: 3 tablas nuevas + 1 funcion. No cambia ni borra nada de lo que ya existe (proveedores, articulos, catalogo_compras...).
--
--  proveedor_marca : que proveedores maneja cada marca (un proveedor puede estar en varias). Es LA relacion; no hay una segunda logica de proveedores.
--  marca_articulo  : productos de una marca cuyos CODIGOS son propios de esa marca (los de Sin Par chocan con los de `articulos`: 113 de 269 codigos
--                    ya existen alli con OTRO producto). `articulos` sigue siendo el de Rocoto/Arrebatao y NO se toca.
--  marca_catalogo  : que proveedor vende cada producto de la marca (y su precio), como catalogo_compras pero por marca.
--
--  REGLA DE LA WEB (js/marca-proveedores.js):  una marca con proveedores vinculados ve SOLO los suyos (mas los que aun no tienen ninguna marca);
--  una marca sin proveedores cargados (123 wok, Casa de Nadie: su base aun no se ha cargado) sigue viendo todo, como hoy.
--
--  importar_marca(marca, filas, aplicar, archivo): carga una planilla de UNA marca. NUNCA fusiona, borra ni sobrescribe proveedores existentes:
--    cada proveedor de la planilla se crea como registro propio de esa marca (aunque tenga nombre o NIT igual a uno existente: puede ser una
--    homologacion) y las coincidencias se REPORTAN para revision. Los proveedores incompletos (sin NIT, correo, telefono) SI se cargan.
--    aplicar=false -> vista previa exacta (hace lo mismo y lo deshace). aplicar=true -> escribe. Idempotente: repetirla no duplica.
-- ============================================================
create table if not exists proveedor_marca (
  proveedor_id bigint not null references proveedores(id) on delete cascade,
  marca_id     int    not null references marcas(id),
  origen       text,
  creado_en    timestamptz not null default now(),
  primary key (proveedor_id, marca_id)
);
create index if not exists ix_proveedor_marca_marca on proveedor_marca(marca_id);

create table if not exists marca_articulo (
  id            bigserial primary key,
  marca_id      int  not null references marcas(id),
  codigo_barras text not null,
  articulo      text,
  unidad_compra text,
  subfamilia    text,
  creado_en     timestamptz not null default now(),
  unique (marca_id, codigo_barras)
);

create table if not exists marca_catalogo (
  id              bigserial primary key,
  marca_id        int    not null references marcas(id),
  codigo_barras   text   not null,
  id_proveedor    bigint not null references proveedores(id) on delete cascade,
  precio_negociado numeric,
  prioridad       int default 1,
  estado          text default 'Aprobado',
  creado_en       timestamptz not null default now(),
  unique (marca_id, codigo_barras, id_proveedor)
);
create index if not exists ix_marca_catalogo_prov on marca_catalogo(id_proveedor);

alter table proveedor_marca enable row level security;
alter table marca_articulo  enable row level security;
alter table marca_catalogo  enable row level security;
do $$ declare t text; begin
  foreach t in array array['proveedor_marca','marca_articulo','marca_catalogo'] loop
    execute format('drop policy if exists %I on %I', t || '_ver', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_ver', t);
    execute format('drop policy if exists %I on %I', t || '_admin', t);
    execute format('create policy %I on %I for all to authenticated using (mi_rol() in (''admin'',''pagos'')) with check (mi_rol() in (''admin'',''pagos''))', t || '_admin', t);
  end loop;
end $$;

-- La base actual de proveedores (los 81 de hoy) queda relacionada con ROCOTO (5) y ARREBATAO (1). Solo agrega relaciones; no toca proveedores.
insert into proveedor_marca (proveedor_id, marca_id, origen)
  select p.id, m.id, 'base_actual' from proveedores p cross join (select id from marcas where lower(nombre) in ('rocoto','arrebatao')) m
  on conflict do nothing;

-- ---------------------------------------------------------------- importar_marca
-- (helper: cuantas llaves tiene un jsonb objeto)
create or replace function jsonb_object_length_(j jsonb) returns int language sql immutable as $ select count(*)::int from jsonb_object_keys(j) $;

create or replace function importar_marca(p_marca int, p_filas jsonb, p_aplicar boolean default false, p_archivo text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nombre text; f jsonb; i int := 0;
  v_cod text; v_prov text; v_art text; v_uni text; v_sub text; v_tel text; v_cor text; v_ase text; v_nit text; v_key text; v_pid bigint; n int;
  provmap jsonb := '{}'::jsonb; vistos text[] := '{}';
  rechazados jsonb := '[]'::jsonb; coincid jsonb := '[]'::jsonb;
  c_filas int := 0; c_prov_nuevos int := 0; c_prov_reusados int := 0; c_sin_nit int := 0; c_sin_tel int := 0; c_sin_cor int := 0;
  c_art_nuevos int := 0; c_art_ya int := 0; c_art_repetidos int := 0; c_choque int := 0; c_choque_nombre int := 0; c_cat_nuevos int := 0; c_cat_ya int := 0;
  v_res jsonb;
begin
  if not (mi_rol() = 'admin' or auth.role() = 'service_role') then raise exception 'Solo el administrador puede importar.'; end if;
  select nombre into v_nombre from marcas where id = p_marca;
  if not found then raise exception 'La marca % no existe.', p_marca; end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'No hay filas para importar.'; end if;
  perform pg_advisory_xact_lock(hashtext('importar_marca'));

  begin   -- sub-transaccion: si es vista previa se deshace todo al final (las variables locales SI se conservan)
    for f in select value from jsonb_array_elements(p_filas) loop
      i := i + 1; c_filas := c_filas + 1;
      v_cod  := upper(regexp_replace(btrim(coalesce(f->>'codigo','')), '\s+', '', 'g'));
      v_prov := btrim(regexp_replace(coalesce(f->>'proveedor',''), '\s+', ' ', 'g'));
      v_art  := nullif(btrim(regexp_replace(coalesce(f->>'articulo',''), '\s+', ' ', 'g')), '');
      v_uni  := nullif(upper(btrim(coalesce(f->>'unidad',''))), '');
      v_sub  := nullif(upper(btrim(coalesce(f->>'subfamilia',''))), '');
      v_tel  := nullif(btrim(coalesce(f->>'telefono','')), '');
      v_cor  := nullif(lower(btrim(coalesce(f->>'correo',''))), '');
      v_ase  := nullif(btrim(coalesce(f->>'asesor','')), '');
      v_nit  := nullif(regexp_replace(coalesce(f->>'nit',''), '\D', '', 'g'), '');
      if v_cod = '' or v_prov = '' then
        rechazados := rechazados || jsonb_build_object('fila', i + 1, 'motivo', case when v_cod = '' then 'sin código' else 'sin proveedor' end, 'codigo', v_cod, 'proveedor', v_prov);
        continue;
      end if;

      -- ---- proveedor (uno por nombre dentro de ESTA planilla; nunca se fusiona con proveedores de otras marcas)
      v_key := imp_clave(v_prov);
      if provmap ? v_key then
        v_pid := (provmap ->> v_key)::bigint;
      else
        select p.id into v_pid from proveedores p join proveedor_marca pm on pm.proveedor_id = p.id and pm.marca_id = p_marca
          where imp_clave(p.razon_social) = v_key order by p.id limit 1;
        if found then   -- ya cargado antes para ESTA marca: se reutiliza y solo se completan campos vacios
          c_prov_reusados := c_prov_reusados + 1;
          update proveedores set telefono1 = coalesce(telefono1, v_tel), correo = coalesce(correo, v_cor), asesor = coalesce(asesor, v_ase) where id = v_pid;
        else
          insert into proveedores (razon_social, telefono1, correo, asesor) values (v_prov, v_tel, v_cor, v_ase) returning id into v_pid;
          insert into proveedor_marca (proveedor_id, marca_id, origen) values (v_pid, p_marca, 'importar_marca:' || coalesce(p_archivo, ''));
          c_prov_nuevos := c_prov_nuevos + 1;
          if v_nit is not null then
            if exists (select 1 from proveedores where nit = v_nit) then
              coincid := coincid || jsonb_build_object('tipo', 'mismo_nit', 'planilla', v_prov, 'nota', 'ya hay un proveedor con ese NIT; NO se fusionó, el nuevo quedó sin NIT');
            else update proveedores set nit = v_nit where id = v_pid; end if;
          end if;
          coincid := coincid || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'nombre_igual', 'planilla', v_prov, 'existente_id', p.id, 'existente', p.razon_social, 'nit', imp_mask(p.nit),
              'marcas', (select coalesce(jsonb_agg(m.nombre), '[]'::jsonb) from proveedor_marca pm join marcas m on m.id = pm.marca_id where pm.proveedor_id = p.id)))
            from proveedores p where p.id <> v_pid and (imp_clave(p.razon_social) = v_key or imp_clave(p.nombre_comercial) = v_key)), '[]'::jsonb);
          if v_nit is null then c_sin_nit := c_sin_nit + 1; end if;
          if v_tel is null then c_sin_tel := c_sin_tel + 1; end if;
          if v_cor is null then c_sin_cor := c_sin_cor + 1; end if;
        end if;
        provmap := provmap || jsonb_build_object(v_key, v_pid);
      end if;

      -- ---- producto de la marca
      if v_cod = any (vistos) then
        c_art_repetidos := c_art_repetidos + 1;
      else
        vistos := vistos || v_cod;
        insert into marca_articulo (marca_id, codigo_barras, articulo, unidad_compra, subfamilia) values (p_marca, v_cod, v_art, v_uni, v_sub)
          on conflict (marca_id, codigo_barras) do nothing;
        get diagnostics n = row_count;
        if n = 1 then
          c_art_nuevos := c_art_nuevos + 1;
          if exists (select 1 from articulos a where a.codigo_barras = v_cod) then
            c_choque := c_choque + 1;
            if exists (select 1 from articulos a where a.codigo_barras = v_cod and imp_clave(coalesce(a.articulo_hiopos, a.articulo_comercial)) <> imp_clave(v_art)) then c_choque_nombre := c_choque_nombre + 1; end if;
          end if;
        else
          c_art_ya := c_art_ya + 1;
          update marca_articulo set articulo = coalesce(articulo, v_art), unidad_compra = coalesce(unidad_compra, v_uni), subfamilia = coalesce(subfamilia, v_sub)
            where marca_id = p_marca and codigo_barras = v_cod;
        end if;
      end if;

      -- ---- quien lo vende
      insert into marca_catalogo (marca_id, codigo_barras, id_proveedor) values (p_marca, v_cod, v_pid) on conflict (marca_id, codigo_barras, id_proveedor) do nothing;
      get diagnostics n = row_count;
      if n = 1 then c_cat_nuevos := c_cat_nuevos + 1; else c_cat_ya := c_cat_ya + 1; end if;
    end loop;

    v_res := jsonb_build_object(
      'aplicado', p_aplicar, 'marca', v_nombre, 'filas', c_filas, 'rechazados', rechazados,
      'proveedores', jsonb_build_object('en_planilla', jsonb_object_length_(provmap), 'nuevos', c_prov_nuevos, 'reutilizados_de_una_carga_anterior', c_prov_reusados,
        'sin_nit', c_sin_nit, 'sin_telefono', c_sin_tel, 'sin_correo', c_sin_cor, 'asociados_a_la_marca', jsonb_object_length_(provmap)),
      'productos', jsonb_build_object('nuevos', c_art_nuevos, 'ya_existian_en_la_marca', c_art_ya, 'filas_con_codigo_repetido_en_la_planilla', c_art_repetidos,
        'codigos_que_tambien_existen_en_articulos_general', c_choque, 'de_esos_con_nombre_distinto', c_choque_nombre),
      'catalogo', jsonb_build_object('relaciones_nuevas', c_cat_nuevos, 'ya_existian', c_cat_ya),
      'coincidencias_para_revisar', coincid);
    if p_aplicar then
      insert into importacion_lote (tipo, archivo, usuario, usuario_nombre, total, nuevos, actualizados, iguales, omitidos, detalle)
        values ('marca:' || v_nombre, p_archivo, auth.uid(), 'importar_marca', c_filas, c_prov_nuevos + c_art_nuevos, 0, c_art_ya, jsonb_array_length(rechazados), v_res);
    else
      raise exception using errcode = 'P0900', message = 'vista previa';   -- deshace la sub-transaccion
    end if;
  exception when sqlstate 'P0900' then
    null;
  end;
  return v_res;
end $$;

revoke all on function importar_marca(int, jsonb, boolean, text) from public, anon;
grant execute on function importar_marca(int, jsonb, boolean, text) to authenticated, service_role;
