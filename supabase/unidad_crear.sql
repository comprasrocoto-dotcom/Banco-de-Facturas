-- ============================================================
--  UNIDADES DE MEDIDA PROPIAS  -  21/09/2026
--  Permite CREAR unidades nuevas (litro, arroba, tula, galon de 5 L...) sin tocar el codigo, y decir COMO las maneja el ERP.
--  SOLO AGREGA: 1 columna nueva y opcional (unidad_catalogo.um_erp) + 1 funcion. No cambia ninguna fila, columna ni politica existente.
--
--  um_erp: la clase de unidad con la que el robot elige la fila en el ERP: KG | LB | UND. Es lo unico que el robot sabe distinguir al facturar.
--          Vacio = como siempre (KG->KG, LB->LB, todo lo demas->UND). Las unidades nuevas quedan con la que se elija al crearlas (por defecto UND).
--  unidad_crear(): solo administrador. Crea la unidad y sus nombres alternos (para que el agente la reconozca en el texto de las facturas).
-- ============================================================
alter table unidad_catalogo add column if not exists um_erp text;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'unidad_catalogo_um_erp_check') then
    alter table unidad_catalogo add constraint unidad_catalogo_um_erp_check check (um_erp is null or um_erp in ('KG', 'LB', 'UND'));
  end if;
end $c$;

create or replace function unidad_crear(
  p_canon text, p_nombre text, p_familia text, p_factor numeric default null, p_um_erp text default 'UND', p_alias text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_canon text; v_nombre text; v_base text; v_um text; v_a text; v_otro text;
  v_alias text[] := '{}';
begin
  if mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador puede crear unidades.' using errcode = '42501'; end if;

  v_canon := regexp_replace(imp_norm(p_canon), '\s+', '', 'g');
  if v_canon !~ '^[A-Z0-9]{1,12}$' then raise exception 'El código debe tener de 1 a 12 letras o números, sin espacios ni signos (ej. GALON, ARROBA).' using errcode = '22023'; end if;
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

  -- nombres con los que el agente la reconoce en las facturas: el codigo, el nombre (si es una palabra) y los que se agreguen (sin espacios)
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

  insert into unidad_catalogo (canon, nombre, familia, base, factor_base, um_erp) values (v_canon, v_nombre, p_familia, v_base, p_factor, v_um);
  insert into unidad_alias (alias, canon, origen) select x, v_canon, 'manual' from unnest(v_alias) x;
  return jsonb_build_object('canon', v_canon, 'nombre', v_nombre, 'familia', p_familia, 'base', v_base, 'factor_base', p_factor, 'um_erp', v_um, 'alias', to_jsonb(v_alias));
end
$fn$;

revoke all on function unidad_crear(text, text, text, numeric, text, text[]) from public, anon;
grant execute on function unidad_crear(text, text, text, numeric, text, text[]) to authenticated;
