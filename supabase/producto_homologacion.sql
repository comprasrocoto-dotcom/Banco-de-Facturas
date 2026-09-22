-- ============================================================
--  HOMOLOGACION DE NOMBRES POR PROVEEDOR (aprendizaje)  -  22/09/2026
--  Cuando el texto de la factura de un proveedor no se parece lo suficiente al nombre que tiene en el pedido/ERP (ej. "AJI PIQUE" vs "AJI DULCE",
--  o "QUESO PARMESANO" que Dulce Mar vende en 2 KILOS y JDH en UNDX2270), la conciliacion no lo empareja y la linea queda como "insumo nuevo" sin
--  serlo. Aqui se APRENDE, POR PROVEEDOR (el mismo texto puede significar otra cosa con otro proveedor), a que nombre EXACTO del pedido corresponde
--  ese texto de factura. Ese nombre YA dice la presentacion (2 KILOS / UNDX2270): no hace falta una tabla aparte para eso.
--  SOLO AGREGA: 2 tablas y 2 funciones. No cambia ninguna tabla, funcion ni politica existente.
-- ============================================================
create table if not exists producto_alias (
  id               bigserial primary key,
  proveedor_nit    text not null,         -- normalizado (solo digitos): el alias es POR PROVEEDOR
  texto_norm       text not null,         -- palabras significativas de la factura, normalizadas y ordenadas (ver lib/producto-alias.js)
  nombre_pedido    text not null,         -- el nombre exacto del insumo en el pedido/ERP al que corresponde
  confirmaciones   integer not null default 1,
  confirmada_admin boolean not null default false,
  creado_por       text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint producto_alias_unico unique (proveedor_nit, texto_norm)
);

create table if not exists producto_revision (
  id                bigserial primary key,
  proveedor_nit     text not null,
  proveedor_nombre  text,
  texto_norm        text not null,
  texto_factura     text not null,        -- tal cual vino en la factura (sin normalizar)
  pedido_numero     text,
  sugerencias       jsonb,                -- [{nombre, score}] candidatos del pedido que la conciliacion ya comparo, para elegir rapido
  estado            text not null default 'pendiente',
  creado_en         timestamptz not null default now(),
  resuelta_en       timestamptz,
  resuelta_por      text,
  nombre_resuelto   text
);
-- una sola pendiente por proveedor+texto (evita que cada corrida repita la misma)
create unique index if not exists producto_revision_pendiente_unica on producto_revision (proveedor_nit, texto_norm) where estado = 'pendiente';
create index if not exists producto_revision_estado_idx on producto_revision (estado);

alter table producto_alias enable row level security;
alter table producto_revision enable row level security;
drop policy if exists pa_leer on producto_alias;
create policy pa_leer on producto_alias for select to authenticated using (mi_rol() = any (array['admin', 'pagos']));
drop policy if exists pr_leer on producto_revision;
create policy pr_leer on producto_revision for select to authenticated using (mi_rol() = any (array['admin', 'pagos']));
revoke all on producto_alias from anon; grant select on producto_alias to authenticated;
revoke all on producto_revision from anon; grant select on producto_revision to authenticated;

-- Ensena (o refuerza) el alias de un producto para un proveedor, y resuelve la revision pendiente si se da su id. Solo admin/pagos (o el agente con la
-- llave de servicio, para registrar la revision pendiente misma via insert directo desde agente-pedidos.js con esa llave).
create or replace function producto_alias_registrar(
  p_proveedor_nit text, p_texto_norm text, p_nombre_pedido text, p_usuario text default null, p_revision_id bigint default null, p_admin boolean default false
) returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare v_id bigint; v_nit text; v_texto text; v_nombre text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Solo admin o pagos pueden ensenar nombres equivalentes.' using errcode = '42501';
  end if;
  v_nit := nullif(regexp_replace(coalesce(p_proveedor_nit, ''), '\D', '', 'g'), '');
  if v_nit is null then raise exception 'Falta el NIT del proveedor.' using errcode = '22023'; end if;
  v_texto := nullif(btrim(coalesce(p_texto_norm, '')), '');
  if v_texto is null then raise exception 'Falta el texto de la factura.' using errcode = '22023'; end if;
  v_nombre := nullif(btrim(coalesce(p_nombre_pedido, '')), '');
  if v_nombre is null or length(v_nombre) > 200 then raise exception 'Di a que nombre del pedido corresponde (hasta 200 caracteres).' using errcode = '22023'; end if;

  insert into producto_alias (proveedor_nit, texto_norm, nombre_pedido, confirmaciones, confirmada_admin, creado_por)
  values (v_nit, v_texto, v_nombre, 1, coalesce(p_admin, false), coalesce(nullif(btrim(p_usuario), ''), 'admin'))
  on conflict (proveedor_nit, texto_norm) do update set
    nombre_pedido = excluded.nombre_pedido, confirmaciones = producto_alias.confirmaciones + 1,
    confirmada_admin = producto_alias.confirmada_admin or excluded.confirmada_admin, actualizado_en = now()
  returning id into v_id;

  if p_revision_id is not null then
    update producto_revision set estado = 'resuelta', resuelta_en = now(), resuelta_por = coalesce(nullif(btrim(p_usuario), ''), 'admin'), nombre_resuelto = v_nombre
     where id = p_revision_id and estado = 'pendiente';
  end if;
  return v_id;
end
$fn$;
revoke all on function producto_alias_registrar(text, text, text, text, bigint, boolean) from public, anon;
grant execute on function producto_alias_registrar(text, text, text, text, bigint, boolean) to authenticated;

-- Descarta una revision SIN crear alias (es un insumo distinto de verdad, no una homologacion; o ya no aplica). Solo admin/pagos.
create or replace function producto_revision_descartar(p_id bigint, p_usuario text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare v_n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Solo admin o pagos pueden descartar.' using errcode = '42501';
  end if;
  update producto_revision set estado = 'resuelta', resuelta_en = now(), resuelta_por = coalesce(nullif(btrim(p_usuario), ''), 'admin')
   where id = p_id and estado = 'pendiente';
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;
revoke all on function producto_revision_descartar(bigint, text) from public, anon;
grant execute on function producto_revision_descartar(bigint, text) to authenticated;
