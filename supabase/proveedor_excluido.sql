-- ============================================================
--  PROVEEDORES QUE COMPRAS NO MANEJA   (18/09/2026)
--  Lista de proveedores que se APARTAN de los listados de cruce / SUBIR FACTURAS (los maneja otra persona).
--  SOLO ADITIVO e idempotente. Nada se borra: "volver a incluir" solo marca activo = false.
--  Se reconoce por NIT (si se conoce) o por nombre normalizado IGUAL (sin S.A.S., tildes ni orden), nunca por "parecido".
-- ============================================================
create table if not exists proveedor_excluido (
  id              bigserial primary key,
  nombre          text not null,
  nombre_norm     text not null,                 -- nombre normalizado y ordenado (lo calcula la pagina)
  nit             text,
  motivo          text,
  activo          boolean not null default true,
  creado_por      text,
  creado_en       timestamptz not null default now(),
  desactivado_por text,
  desactivado_en  timestamptz
);
create unique index if not exists ux_proveedor_excluido_norm on proveedor_excluido (nombre_norm) where activo;
alter table proveedor_excluido enable row level security;
drop policy if exists proveedor_excluido_leer on proveedor_excluido;
create policy proveedor_excluido_leer on proveedor_excluido for select to authenticated using (mi_rol() in ('admin','pagos'));

-- Apartar un proveedor (si ya estaba apartado, solo completa el NIT). Devuelve el id.
create or replace function proveedor_excluir(p_nombre text, p_nombre_norm text, p_nit text default null, p_motivo text default null, p_usuario text default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare v_id bigint; v_nit text := nullif(regexp_replace(coalesce(p_nit,''), '\D', '', 'g'), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para apartar proveedores'; end if;
  if coalesce(trim(p_nombre),'') = '' or coalesce(trim(p_nombre_norm),'') = '' then raise exception 'falta el nombre del proveedor'; end if;
  select id into v_id from proveedor_excluido where activo and nombre_norm = p_nombre_norm;
  if v_id is not null then
    update proveedor_excluido set nit = coalesce(nit, v_nit) where id = v_id;
    return v_id;
  end if;
  insert into proveedor_excluido (nombre, nombre_norm, nit, motivo, creado_por)
  values (left(trim(p_nombre), 300), left(p_nombre_norm, 300), v_nit, left(p_motivo, 300), left(p_usuario, 120)) returning id into v_id;
  return v_id;
end $fn$;

-- Volver a incluir un proveedor (no se borra: queda inactivo y con quien lo hizo)
create or replace function proveedor_reincorporar(p_id bigint, p_usuario text default null) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para volver a incluir proveedores'; end if;
  update proveedor_excluido set activo = false, desactivado_por = left(p_usuario, 120), desactivado_en = now() where id = p_id and activo;
end $fn$;

revoke all on function proveedor_excluir(text,text,text,text,text) from public, anon;
revoke all on function proveedor_reincorporar(bigint,text) from public, anon;
grant execute on function proveedor_excluir(text,text,text,text,text) to authenticated, service_role;
grant execute on function proveedor_reincorporar(bigint,text) to authenticated, service_role;
