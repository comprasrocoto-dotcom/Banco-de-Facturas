-- ============================================================
--  NOTAS CREDITO AMARRADAS A SUS FACTURAS (trazabilidad)  -  21/09/2026
--  Una nota credito corrige o anula (total o parcialmente) una o varias facturas del MISMO proveedor. Hasta ahora quedaba suelta en el banco.
--  SOLO AGREGA: 1 tabla nueva (nota_credito_factura) y 2 funciones. No cambia ninguna factura, pedido ni politica existente.
--   - una nota puede ir a varias facturas y una factura puede tener varias notas;
--   - solo admin / pagos amarran o quitan (por las funciones); todos leen lo que ya pueden ver de facturas;
--   - la nota tiene que ser tipo nota_credito, la factura tipo factura y las dos del MISMO proveedor (NIT emisor).
--  Si se borra una factura o nota, sus amarres se borran solos (on delete cascade).
-- ============================================================
create table if not exists nota_credito_factura (
  id           bigserial primary key,
  nota_cufe    text not null references facturas(cufe) on delete cascade,
  factura_cufe text not null references facturas(cufe) on delete cascade,
  creado_por   text,
  creado_en    timestamptz not null default now(),
  constraint nota_credito_factura_unica unique (nota_cufe, factura_cufe),
  constraint nota_credito_factura_distintas check (nota_cufe <> factura_cufe)
);
create index if not exists nota_credito_factura_factura_idx on nota_credito_factura (factura_cufe);

alter table nota_credito_factura enable row level security;
drop policy if exists ncf_leer on nota_credito_factura;
-- se ve un amarre si se ve la nota o la factura (las politicas de facturas aplican dentro de este exists)
create policy ncf_leer on nota_credito_factura for select to authenticated
  using (exists (select 1 from facturas f where f.cufe = nota_credito_factura.nota_cufe)
      or exists (select 1 from facturas f where f.cufe = nota_credito_factura.factura_cufe));
revoke all on nota_credito_factura from anon;
grant select on nota_credito_factura to authenticated;

-- Amarra una nota credito a una o varias facturas. Devuelve cuantos amarres NUEVOS hizo (los que ya existian no se repiten).
create or replace function nota_credito_amarrar(p_nota text, p_facturas text[], p_usuario text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_nota facturas%rowtype; v_f facturas%rowtype; v_c text; v_n integer := 0; v_i integer; v_nit_n text; v_nit_f text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Solo admin o pagos pueden amarrar notas crédito.' using errcode = '42501';
  end if;
  select * into v_nota from facturas where cufe = p_nota;
  if not found then raise exception 'La nota crédito no existe.' using errcode = '22023'; end if;
  if v_nota.tipo::text <> 'nota_credito' then raise exception 'Ese documento no es una nota crédito.' using errcode = '22023'; end if;
  if p_facturas is null or cardinality(p_facturas) = 0 then raise exception 'Elige al menos una factura.' using errcode = '22023'; end if;
  v_nit_n := regexp_replace(coalesce(v_nota.nit_emisor, ''), '\D', '', 'g');
  foreach v_c in array p_facturas loop
    select * into v_f from facturas where cufe = v_c;
    if not found then raise exception 'Una de las facturas elegidas no existe.' using errcode = '22023'; end if;
    if v_f.tipo::text <> 'factura' then raise exception 'Una nota crédito solo se amarra a facturas.' using errcode = '22023'; end if;
    v_nit_f := regexp_replace(coalesce(v_f.nit_emisor, ''), '\D', '', 'g');
    if v_nit_n = '' or v_nit_n <> v_nit_f then
      raise exception 'La factura % es de otro proveedor: una nota crédito solo se amarra a facturas de su mismo proveedor.', coalesce(nullif(v_f.documento, ''), v_f.prefijo || v_f.folio, v_f.cufe) using errcode = '22023';
    end if;
    insert into nota_credito_factura (nota_cufe, factura_cufe, creado_por)
    values (p_nota, v_c, coalesce(nullif(btrim(p_usuario), ''), 'admin')) on conflict (nota_cufe, factura_cufe) do nothing;
    get diagnostics v_i = row_count; v_n := v_n + v_i;
  end loop;
  return v_n;
end
$fn$;
revoke all on function nota_credito_amarrar(text, text[], text) from public, anon;
grant execute on function nota_credito_amarrar(text, text[], text) to authenticated;

-- Quita un amarre (la nota y la factura no se tocan). Devuelve 1 si lo quito, 0 si no existia.
create or replace function nota_credito_desamarrar(p_nota text, p_factura text)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare v_n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Solo admin o pagos pueden quitar el amarre de una nota crédito.' using errcode = '42501';
  end if;
  delete from nota_credito_factura where nota_cufe = p_nota and factura_cufe = p_factura;
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;
revoke all on function nota_credito_desamarrar(text, text) from public, anon;
grant execute on function nota_credito_desamarrar(text, text) to authenticated;
