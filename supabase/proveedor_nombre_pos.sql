-- ============================================================
--  proveedor_nombre_pos.sql  -  ENSEÑARLE AL AGENTE proveedores (28/09/2026)   ADITIVO: no toca nada existente, en especial NO toca proveedor_alias
--  Cuando el bot de pedidos no encuentra el proveedor en el ERP (el nombre del pedido no coincide con el que usa el ERP: p.ej. "HIELO" vs "HIELOS"),
--  antes solo quedaba en un archivo local (REVISAR_pedidos_*.txt). Ahora queda en proveedor_revision para decidir en la web (Admin > Agente >
--  "Proveedores por decidir"), y lo que se enseña queda en proveedor_nombre_pos (nit -> nombre EXACTO que hay que buscar en el ERP): la proxima
--  vez que un pedido traiga ese NIT, el agente usa ese nombre directamente, sin volver a preguntar.
--  OJO: esto es un mapa aparte de proveedor_alias (esa es la homologacion de nombres de la DIAN para el Cruce/Conciliacion; no se toca ni se lee aqui).
-- ============================================================

-- nit -> nombre EXACTO que el modulo de Pedidos de compra del ERP reconoce (uno por NIT; se sobreescribe si se vuelve a ensenar)
create table if not exists proveedor_nombre_pos (
  nit            text primary key,
  nombre_pos     text not null,
  creado_por     text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz
);
alter table proveedor_nombre_pos enable row level security;
drop policy if exists proveedor_nombre_pos_leer on proveedor_nombre_pos;
create policy proveedor_nombre_pos_leer on proveedor_nombre_pos for select to authenticated using (mi_rol() = any (array['admin','pagos']));
revoke all on proveedor_nombre_pos from anon, authenticated;   -- el agente lee/escribe con la llave de servicio (bypasa RLS); desde la web solo se lee y solo se ensena por la funcion de abajo
grant select on proveedor_nombre_pos to authenticated;

-- cola de revision: un proveedor de un pedido que el bot no pudo encontrar en el ERP
create table if not exists proveedor_revision (
  id              bigint generated always as identity primary key,
  proveedor_nit   text,
  proveedor_texto text not null,
  pedido_numero   text,
  sugerencias     jsonb,        -- nombres que el ERP SI mostro al filtrar (para elegir con un clic)
  estado          text not null default 'pendiente' check (estado in ('pendiente','resuelta')),
  creado_en       timestamptz not null default now(),
  resuelta_en     timestamptz,
  resuelta_por    text,
  nombre_resuelto text
);
-- una sola fila pendiente por proveedor+texto (evita que cada corrida duplique la misma pregunta)
create unique index if not exists proveedor_revision_pendiente_idx on proveedor_revision (coalesce(proveedor_nit, ''), proveedor_texto) where estado = 'pendiente';
create index if not exists proveedor_revision_estado_idx on proveedor_revision (estado, creado_en desc);

alter table proveedor_revision enable row level security;
drop policy if exists proveedor_revision_leer on proveedor_revision;
create policy proveedor_revision_leer on proveedor_revision for select to authenticated using (mi_rol() = any (array['admin','pagos']));
revoke all on proveedor_revision from anon, authenticated;
grant select on proveedor_revision to authenticated;

-- Ensena (o corrige) el nombre que usa el ERP para un NIT, y si viene de una revision pendiente la cierra. Mismo patron que producto_alias_registrar.
create or replace function proveedor_nombre_pos_registrar(p_nit text, p_nombre_pos text, p_usuario text default null, p_revision_id bigint default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_nit text; v_nombre text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Solo admin o pagos pueden enseñar proveedores.' using errcode = '42501';
  end if;
  v_nit := nullif(regexp_replace(coalesce(p_nit, ''), '\D', '', 'g'), '');
  if v_nit is null then raise exception 'Falta el NIT del proveedor.' using errcode = '22023'; end if;
  v_nombre := nullif(btrim(coalesce(p_nombre_pos, '')), '');
  if v_nombre is null or length(v_nombre) > 200 then raise exception 'Escribe el nombre exacto que usa el ERP (hasta 200 caracteres).' using errcode = '22023'; end if;

  insert into proveedor_nombre_pos (nit, nombre_pos, creado_por)
  values (v_nit, v_nombre, coalesce(nullif(btrim(p_usuario), ''), 'admin'))
  on conflict (nit) do update set nombre_pos = excluded.nombre_pos, creado_por = excluded.creado_por, actualizado_en = now();

  if p_revision_id is not null then
    update proveedor_revision set estado = 'resuelta', resuelta_en = now(), resuelta_por = coalesce(nullif(btrim(p_usuario), ''), 'admin'), nombre_resuelto = v_nombre
     where id = p_revision_id and estado = 'pendiente';
  end if;
  return v_nit;
end
$$;
revoke all on function proveedor_nombre_pos_registrar(text, text, text, bigint) from public;
grant execute on function proveedor_nombre_pos_registrar(text, text, text, bigint) to authenticated;

-- "No existe en el ERP" / "no es este": solo saca la fila de la lista, no ensena nada. Mismo patron que producto_revision_descartar.
create or replace function proveedor_revision_descartar(p_id bigint, p_usuario text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Solo admin o pagos pueden descartar.' using errcode = '42501';
  end if;
  update proveedor_revision set estado = 'resuelta', resuelta_en = now(), resuelta_por = coalesce(nullif(btrim(p_usuario), ''), 'admin')
   where id = p_id and estado = 'pendiente';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function proveedor_revision_descartar(bigint, text) from public;
grant execute on function proveedor_revision_descartar(bigint, text) to authenticated;
