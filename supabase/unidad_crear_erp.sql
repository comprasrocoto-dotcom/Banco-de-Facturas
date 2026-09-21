-- ============================================================
--  UNIDADES PROPIAS: NOMBRE DE LA UNIDAD DE COMPRA EN EL ERP  -  21/09/2026
--  El ERP maneja cada articulo con una unidad de COMPRA de nombre propio (ej. PAQUETEX25UND) y una de inventario (unidad). El robot elige la fila
--  del ERP buscando ese nombre. SOLO AGREGA: 1 columna nueva y opcional (unidad_catalogo.erp_compra) y reemplaza la funcion unidad_crear (creada hoy,
--  sin datos) por una version que ademas guarda erp_compra y admite codigos de hasta 20 caracteres. No cambia ninguna fila existente.
-- ============================================================
alter table unidad_catalogo add column if not exists erp_compra text;

drop function if exists unidad_crear(text, text, text, numeric, text, text[]);
create or replace function unidad_crear(
  p_canon text, p_nombre text, p_familia text, p_factor numeric default null, p_um_erp text default 'UND', p_alias text[] default '{}', p_erp_compra text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_canon text; v_nombre text; v_base text; v_um text; v_a text; v_otro text; v_erp text;
  v_alias text[] := '{}';
begin
  if mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador puede crear unidades.' using errcode = '42501'; end if;

  v_canon := regexp_replace(imp_norm(p_canon), '\s+', '', 'g');
  if v_canon !~ '^[A-Z0-9]{1,20}$' then raise exception 'El código debe tener de 1 a 20 letras o números, sin espacios ni signos (ej. GALON, ARROBA).' using errcode = '22023'; end if;
  v_nombre := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  if length(v_nombre) < 2 or length(v_nombre) > 40 then raise exception 'El nombre debe tener entre 2 y 40 caracteres.' using errcode = '22023'; end if;
  if p_familia is null or p_familia not in ('masa', 'volumen', 'conteo', 'empaque') then raise exception 'El tipo debe ser masa, volumen, conteo o empaque.' using errcode = '22023'; end if;
  if p_familia = 'empaque' then
    v_base := null; p_factor := null;
  else
    if p_factor is null or p_factor <= 0 or p_factor > 100000000 then raise exception 'Di cuánto equivale 1 %: un número mayor que 0.', v_nombre using errcode = '22023'; end if;
    v_base := case p_familia when 'masa' then 'g' when 'volumen' then 'ml' else 'und' end;
  end if;
  v_um := upper(btrim(coalesce(p_um_erp, 'UND')));
  if v_um not in ('KG', 'LB', 'UND') then raise exception 'La clase del ERP debe ser KG, LB o UND.' using errcode = '22023'; end if;
  if exists (select 1 from unidad_catalogo where canon = v_canon) then raise exception 'Ya existe una unidad con el código %.', v_canon using errcode = '23505'; end if;

  -- nombre de la unidad de compra en el ERP (opcional): el robot busca la fila que lo trae
  v_erp := nullif(regexp_replace(btrim(coalesce(p_erp_compra, '')), '\s+', ' ', 'g'), '');
  if v_erp is not null then
    if length(v_erp) > 60 then raise exception 'El nombre de la unidad del ERP es muy largo (máximo 60 caracteres).' using errcode = '22023'; end if;
    select canon into v_otro from unidad_catalogo where erp_compra is not null and imp_formato(erp_compra) = imp_formato(v_erp) limit 1;
    if v_otro is not null then raise exception 'La unidad del ERP "%" ya está asociada a la unidad %.', v_erp, v_otro using errcode = '23505'; end if;
  end if;

  v_alias := array[v_canon];
  if imp_norm(v_nombre) ~ '^[A-Z0-9]{1,20}$' then v_alias := array_append(v_alias, imp_norm(v_nombre)); end if;
  foreach v_a in array coalesce(p_alias, '{}') loop
    v_a := imp_norm(v_a);
    if v_a = '' then continue; end if;
    if v_a !~ '^[A-Z0-9]{1,20}$' then raise exception 'El nombre alterno "%" no es válido: solo letras y números, sin espacios.', v_a using errcode = '22023'; end if;
    v_alias := array_append(v_alias, v_a);
  end loop;
  select array_agg(distinct x) into v_alias from unnest(v_alias) x;
  foreach v_a in array v_alias loop
    select canon into v_otro from unidad_alias where alias = v_a;
    if v_otro is not null then raise exception '"%" ya se usa para otra unidad (%).', v_a, v_otro using errcode = '23505'; end if;
  end loop;
  -- el nombre del ERP tambien sirve de nombre alterno si es una sola palabra y no lo usa otra unidad (si lo usa, simplemente no se agrega)
  if v_erp is not null and imp_norm(v_erp) ~ '^[A-Z0-9]{1,20}$' and not (imp_norm(v_erp) = any (v_alias))
     and not exists (select 1 from unidad_alias where alias = imp_norm(v_erp)) then
    v_alias := array_append(v_alias, imp_norm(v_erp));
  end if;

  insert into unidad_catalogo (canon, nombre, familia, base, factor_base, um_erp, erp_compra) values (v_canon, v_nombre, p_familia, v_base, p_factor, v_um, v_erp);
  insert into unidad_alias (alias, canon, origen) select x, v_canon, 'manual' from unnest(v_alias) x;
  return jsonb_build_object('canon', v_canon, 'nombre', v_nombre, 'familia', p_familia, 'base', v_base, 'factor_base', p_factor, 'um_erp', v_um, 'erp_compra', v_erp, 'alias', to_jsonb(v_alias));
end
$fn$;

revoke all on function unidad_crear(text, text, text, numeric, text, text[], text) from public, anon;
grant execute on function unidad_crear(text, text, text, numeric, text, text[], text) to authenticated;
