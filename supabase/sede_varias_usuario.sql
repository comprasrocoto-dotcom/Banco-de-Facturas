-- ============================================================
-- UN USUARIO DE SEDE QUE TRABAJA EN VARIAS SEDES  (10/11/2026)
--   Pedido del usuario: «que planta pueda hacer pedido en la misma web y con el mismo perfil tanto de Planta de Rocoto como de 123 wok».
--   Toda la seguridad de los usuarios de sede usa UNA sede (perfiles.sede_id -> mi_sede() / mi_marca()). Para no tocar ninguna
--   regla que ya funciona, el usuario elige ARRIBA en la web en cual de SUS sedes esta trabajando; cambiar_mi_sede() cambia
--   perfiles.sede_id SOLO a una sede que el administrador le asigno. Todo lo demas (pedidos, fotos, envios, catalogo) sigue igual.
--   Solo agrega: una tabla nueva y 4 funciones nuevas. No cambia ni borra nada que exista.
-- ============================================================
create table if not exists perfil_sede_trabajo (
  user_id      uuid not null references perfiles(user_id) on delete cascade,
  sede_id      int  not null references sedes(id) on delete cascade,
  asignado_por uuid,
  creado_en    timestamptz not null default now(),
  primary key (user_id, sede_id)
);
alter table perfil_sede_trabajo enable row level security;
drop policy if exists perfil_sede_trabajo_ver on perfil_sede_trabajo;
create policy perfil_sede_trabajo_ver on perfil_sede_trabajo for select to authenticated using (user_id = auth.uid() or usuario_puede_gestionar());
-- (sin politicas de escritura: solo las funciones de abajo, que son security definer)

-- sedes entre las que puede cambiar el usuario que entra (vacio = una sola sede, como siempre)
create or replace function mis_sedes_trabajo() returns jsonb language sql stable security definer set search_path = public as $f$
  select case when not exists (select 1 from perfil_sede_trabajo where user_id = auth.uid()) then '[]'::jsonb else
    (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'marca', m.nombre) order by m.nombre, s.nombre), '[]'::jsonb)
       from sedes s left join marcas m on m.id = s.marca_id
      where s.id in (select sede_id from perfil_sede_trabajo where user_id = auth.uid()
                     union select sede_id from perfiles where user_id = auth.uid() and sede_id is not null)) end
$f$;

-- el usuario de sede cambia la sede en la que esta trabajando (solo a una de las suyas)
create or replace function cambiar_mi_sede(p_sede int) returns int language plpgsql security definer set search_path = public as $f$
declare v_rol text; v_act int;
begin
  select rol, sede_id into v_rol, v_act from perfiles where user_id = auth.uid() and coalesce(activo, true);
  if v_rol is distinct from 'sede' then raise exception 'solo los usuarios de sede cambian de sede' using errcode = '42501'; end if;
  if p_sede is null then raise exception 'elige la sede' using errcode = '22023'; end if;
  if p_sede = v_act then return p_sede; end if;
  if not exists (select 1 from perfil_sede_trabajo where user_id = auth.uid() and sede_id = p_sede) then
    raise exception 'esa sede no esta asignada a tu usuario' using errcode = '42501';
  end if;
  update perfiles set sede_id = p_sede where user_id = auth.uid();
  return p_sede;
end $f$;

-- ---------------------------------------------------------------- asignar (solo quien gestiona usuarios)
create or replace function sedes_trabajo_listar() returns table (user_id uuid, sede_id int) language plpgsql stable security definer set search_path = public as $f$
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para ver las sedes de los usuarios' using errcode = '42501'; end if;
  return query select t.user_id, t.sede_id from perfil_sede_trabajo t order by t.user_id, t.sede_id;
end $f$;

-- p_sedes = TODAS las sedes donde trabaja (la suya de hoy se agrega sola). Vacio o una sola = vuelve a ser de una sede.
create or replace function sedes_trabajo_guardar(p_user uuid, p_sedes int[]) returns int language plpgsql security definer set search_path = public as $f$
declare v_rol text; v_act int; v_n int;
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para asignar sedes' using errcode = '42501'; end if;
  select rol, sede_id into v_rol, v_act from perfiles where user_id = p_user;
  if v_rol is null then raise exception 'el usuario no existe' using errcode = '22023'; end if;
  p_sedes := coalesce((select array_agg(distinct x) from unnest(coalesce(p_sedes, '{}'::int[])) x where x is not null), '{}'::int[]);
  if cardinality(p_sedes) > 0 and v_act is not null and not (v_act = any (p_sedes)) then p_sedes := p_sedes || v_act; end if;
  if cardinality(p_sedes) < 2 then p_sedes := '{}'::int[]; end if;   -- con una sola sede no hace falta nada
  if v_rol <> 'sede' and cardinality(p_sedes) > 0 then raise exception 'solo los usuarios de sede trabajan en varias sedes (los analistas usan sus sedes asignadas)' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_sedes) s where not exists (select 1 from sedes where id = s)) then raise exception 'alguna sede no existe' using errcode = '22023'; end if;
  delete from perfil_sede_trabajo where user_id = p_user and not (sede_id = any (p_sedes));
  insert into perfil_sede_trabajo (user_id, sede_id, asignado_por) select p_user, s, auth.uid() from unnest(p_sedes) s on conflict do nothing;
  select count(*) into v_n from perfil_sede_trabajo where user_id = p_user; return v_n;
end $f$;

revoke all on function mis_sedes_trabajo(), cambiar_mi_sede(int), sedes_trabajo_listar(), sedes_trabajo_guardar(uuid, int[]) from public, anon;
grant execute on function mis_sedes_trabajo(), cambiar_mi_sede(int), sedes_trabajo_listar(), sedes_trabajo_guardar(uuid, int[]) to authenticated;
