-- ============================================================
--  USUARIOS, PERFILES Y PERMISOS (Admin -> Usuarios y perfiles)  -  25/09/2026
--  Reutiliza lo que ya existe: la tabla `perfiles` ES la lista de usuarios (user_id, nombre, rol, sede_id, activo) y `rol` (admin | pagos | sede) sigue siendo
--  el NIVEL DE DATOS que leen las ~50 reglas de seguridad y las funciones actuales: NO se tocan. SOLO AGREGA:
--   - permiso_catalogo : lista de permisos (modulo + accion) que se pueden dar o quitar
--   - perfil_acceso    : "perfiles" (Administrador, Pagos, Sede + los que se creen); cada uno se apoya en un nivel de datos (admin/pagos/sede)
--   - perfil_permiso   : que permisos tiene cada perfil
--   - perfiles.perfil_id / debe_cambiar_clave (2 columnas nuevas)
--   Los 3 perfiles de hoy se siembran IGUAL a como funcionan ahora: nadie gana ni pierde acceso al activarlo.
--   Servidor: solo lo critico exige permiso (gestionar usuarios, borrar facturas, borrar pedidos, iniciar ingresos), con reglas RESTRICTIVAS que se SUMAN a las
--   existentes (no las reemplazan). El resto de permisos gobierna la web.
--   Crear el usuario de acceso (auth) NO se puede hacer desde la web ni la base: lo hace la Edge Function `admin-usuarios` con la llave de servicio de Supabase.
--   Los usuarios desactivados (activo=false) quedan sin acceso tambien en el servidor: mi_rol() devuelve 'inactivo'.
-- ============================================================

-- ---------- catalogo de permisos ----------
create table if not exists permiso_catalogo (
  permiso  text primary key,
  modulo   text not null,
  etiqueta text not null,
  orden    int  not null default 0,
  critico  boolean not null default false     -- true = ademas lo exige el servidor
);
insert into permiso_catalogo (permiso, modulo, etiqueta, orden, critico) values
  ('facturas.ver',            'Facturas',   'Ver el banco de facturas',                    10, false),
  ('facturas.subir',          'Facturas',   'Subir facturas y descargar de la DIAN',       11, false),
  ('facturas.sellar',         'Facturas',   'Sellar / aprobar facturas',                   12, false),
  ('facturas.asignar',        'Facturas',   'Asignar estado y responsable de la factura',  13, false),
  ('facturas.borrar',         'Facturas',   'Borrar facturas',                             14, true),
  ('pedidos.ver',             'Pedidos',    'Ver pedidos',                                 20, false),
  ('pedidos.crear',           'Pedidos',    'Crear y editar pedidos',                      21, false),
  ('pedidos.amarrar',         'Pedidos',    'Amarrar facturas a pedidos',                  22, false),
  ('pedidos.enviar_proveedor','Pedidos',    'Enviar el pedido al proveedor',               23, false),
  ('pedidos.borrar',          'Pedidos',    'Borrar pedidos',                              24, true),
  ('cruce_dian.ver',          'Cruce DIAN', 'Ver y trabajar el Cruce DIAN',                30, false),
  ('precios.ver',             'Precios',    'Ver variacion de precios',                    40, false),
  ('admin.ver',               'Admin',      'Entrar al modulo Admin (proveedores, articulos, catalogo)', 50, false),
  ('admin.agente',            'Admin',      'Ver y decidir lo que aprende el agente',      51, false),
  ('admin.importar',          'Admin',      'Importar bases',                              52, false),
  ('admin.usuarios',          'Admin',      'Gestionar usuarios, perfiles y permisos',     53, true),
  ('ingresos.iniciar',        'Ingresos',   'Iniciar los ingresos al ERP (el agente)',     60, true)
on conflict (permiso) do nothing;

-- ---------- perfiles de acceso ----------
create table if not exists perfil_acceso (
  id          serial primary key,
  clave       text not null unique,
  nombre      text not null,
  descripcion text,
  nivel       text not null check (nivel in ('admin', 'pagos', 'sede')),   -- el `rol` que se le pone al usuario (lo que leen las reglas de seguridad de siempre)
  sistema     boolean not null default false,                               -- los 3 de origen: no se borran ni cambian de nivel
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
create table if not exists perfil_permiso (
  perfil_id int  not null references perfil_acceso(id) on delete cascade,
  permiso   text not null references permiso_catalogo(permiso) on update cascade,
  primary key (perfil_id, permiso)
);

insert into perfil_acceso (clave, nombre, descripcion, nivel, sistema) values
  ('administrador', 'Administrador', 'Acceso total: usuarios, admin, ingresos, borrados.',                     'admin', true),
  ('pagos',         'Pagos',         'Facturas, pedidos, Cruce DIAN y precios. Sin Admin ni borrados.',         'pagos', true),
  ('sede',          'Sede',          'Ve y trabaja solo lo de su sede: sellar facturas y crear pedidos.',       'sede',  true)
on conflict (clave) do nothing;

insert into perfil_permiso (perfil_id, permiso)
select a.id, c.permiso from perfil_acceso a join permiso_catalogo c on
  (a.clave = 'administrador')
  or (a.clave = 'pagos' and c.permiso in ('facturas.ver','facturas.subir','facturas.sellar','facturas.asignar','pedidos.ver','pedidos.crear','pedidos.amarrar','pedidos.enviar_proveedor','cruce_dian.ver','precios.ver'))
  or (a.clave = 'sede'  and c.permiso in ('facturas.ver','facturas.sellar','pedidos.ver','pedidos.crear','pedidos.amarrar','pedidos.enviar_proveedor'))   -- 26/09/2026: la sede tambien envia SUS pedidos (ver sedes_envian_pedidos.sql)
on conflict do nothing;

alter table perfiles add column if not exists perfil_id int references perfil_acceso(id);
alter table perfiles add column if not exists debe_cambiar_clave boolean not null default false;
update perfiles p set perfil_id = (select a.id from perfil_acceso a where a.clave = case p.rol when 'admin' then 'administrador' else p.rol end) where p.perfil_id is null;

-- ---------- lectura ----------
alter table permiso_catalogo enable row level security;
alter table perfil_acceso    enable row level security;
alter table perfil_permiso   enable row level security;
drop policy if exists pc_leer  on permiso_catalogo;
drop policy if exists pa2_leer on perfil_acceso;
drop policy if exists pp_leer  on perfil_permiso;
create policy pc_leer  on permiso_catalogo for select to authenticated using (true);
create policy pa2_leer on perfil_acceso    for select to authenticated using (mi_rol() = 'admin');
create policy pp_leer  on perfil_permiso   for select to authenticated using (mi_rol() = 'admin');
revoke all on permiso_catalogo, perfil_acceso, perfil_permiso from anon;
grant select on permiso_catalogo, perfil_acceso, perfil_permiso to authenticated;

-- ---------- permisos de quien esta conectado ----------
create or replace function mis_permisos() returns text[]
language sql stable security definer set search_path = public as $fn$
  select coalesce((select array_agg(pp.permiso order by pp.permiso)
                     from perfiles p join perfil_permiso pp on pp.perfil_id = p.perfil_id
                    where p.user_id = auth.uid() and p.activo), '{}'::text[])
$fn$;
create or replace function tiene_permiso(p text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(p = any (mis_permisos()), false)
$fn$;
revoke all on function mis_permisos(), tiene_permiso(text) from public, anon;
grant execute on function mis_permisos(), tiene_permiso(text) to authenticated;

-- ---------- usuario desactivado = sin acceso (antes `activo` no lo revisaba nadie) ----------
create or replace function mi_rol() returns text
language sql stable security definer
as $function$ select coalesce((select case when activo then rol else 'inactivo' end from perfiles where user_id = auth.uid()), 'sede') $function$;

-- ---------- reglas RESTRICTIVAS (se suman a las de siempre; para el perfil Administrador, que tiene todos los permisos, todo queda igual) ----------
drop policy if exists r_facturas_borrar on facturas;
create policy r_facturas_borrar on facturas as restrictive for delete to authenticated using (tiene_permiso('facturas.borrar'));
drop policy if exists r_pedidos_borrar on pedidos;
create policy r_pedidos_borrar on pedidos as restrictive for delete to authenticated using (tiene_permiso('pedidos.borrar'));
drop policy if exists r_ordenes_iniciar on ordenes;
create policy r_ordenes_iniciar on ordenes as restrictive for insert to authenticated with check (tiene_permiso('ingresos.iniciar'));

-- ---------- gestion (todo pasa por aqui; la tabla perfiles sigue sin escritura directa) ----------
create or replace function usuario_puede_gestionar() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(auth.role() = 'service_role', false) or tiene_permiso('admin.usuarios')
$fn$;

-- Lista de usuarios con su perfil, sede, correo y ultimo ingreso (el correo vive en auth.users, que la web no puede leer)
create or replace function usuarios_listar() returns table (
  user_id uuid, nombre text, email text, rol text, activo boolean, sede_id int, sede text, marca text,
  perfil_id int, perfil text, debe_cambiar_clave boolean, ultimo_ingreso timestamptz, creado timestamptz)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para ver usuarios' using errcode = '42501'; end if;
  return query
    select p.user_id, p.nombre, u.email::text, p.rol, p.activo, p.sede_id, s.nombre::text, m.nombre::text,
           p.perfil_id, a.nombre, p.debe_cambiar_clave, u.last_sign_in_at, p.created_at
      from perfiles p
      left join auth.users u on u.id = p.user_id
      left join sedes s on s.id = p.sede_id
      left join marcas m on m.id = s.marca_id
      left join perfil_acceso a on a.id = p.perfil_id
     order by p.activo desc, p.nombre;
end
$fn$;

-- Crea o corrige la fila de `perfiles` de un usuario (el usuario de acceso ya lo creo la Edge Function). El `rol` sale del perfil elegido.
create or replace function usuario_registrar(p_user_id uuid, p_nombre text, p_perfil_id int, p_sede_id int, p_debe_cambiar boolean default true)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_nivel text;
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para gestionar usuarios' using errcode = '42501'; end if;
  if p_user_id is null then raise exception 'falta el usuario' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_nombre, '')), '') is null then raise exception 'falta el nombre' using errcode = '22023'; end if;
  select nivel into v_nivel from perfil_acceso where id = p_perfil_id and activo;
  if v_nivel is null then raise exception 'perfil no existe o esta inactivo' using errcode = '22023'; end if;
  if v_nivel = 'sede' and p_sede_id is null then raise exception 'un usuario de sede necesita su sede' using errcode = '22023'; end if;
  if p_sede_id is not null and not exists (select 1 from sedes where id = p_sede_id) then raise exception 'la sede no existe' using errcode = '22023'; end if;
  insert into perfiles (user_id, nombre, rol, sede_id, activo, perfil_id, debe_cambiar_clave)
  values (p_user_id, btrim(p_nombre), v_nivel, p_sede_id, true, p_perfil_id, coalesce(p_debe_cambiar, true))
  on conflict (user_id) do update set nombre = excluded.nombre, rol = excluded.rol, sede_id = excluded.sede_id, perfil_id = excluded.perfil_id,
                                      debe_cambiar_clave = excluded.debe_cambiar_clave;
end
$fn$;

-- Cambia nombre / perfil / sede / activo. Nunca deja al sistema sin un usuario activo con permiso de gestionar usuarios, y nadie se quita el acceso a si mismo.
create or replace function usuario_actualizar(p_user_id uuid, p_nombre text, p_perfil_id int, p_sede_id int, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_nivel text; v_quedan int; v_yo boolean := (p_user_id = auth.uid());
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para gestionar usuarios' using errcode = '42501'; end if;
  if not exists (select 1 from perfiles where user_id = p_user_id) then raise exception 'el usuario no existe' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_nombre, '')), '') is null then raise exception 'falta el nombre' using errcode = '22023'; end if;
  select nivel into v_nivel from perfil_acceso where id = p_perfil_id and activo;
  if v_nivel is null then raise exception 'perfil no existe o esta inactivo' using errcode = '22023'; end if;
  if v_nivel = 'sede' and p_sede_id is null then raise exception 'un usuario de sede necesita su sede' using errcode = '22023'; end if;
  if p_sede_id is not null and not exists (select 1 from sedes where id = p_sede_id) then raise exception 'la sede no existe' using errcode = '22023'; end if;
  if v_yo and not coalesce(p_activo, true) then raise exception 'no puedes desactivarte a ti mismo' using errcode = '22023'; end if;
  if v_yo and not exists (select 1 from perfil_permiso pp where pp.perfil_id = p_perfil_id and pp.permiso = 'admin.usuarios') then raise exception 'no puedes quitarte a ti mismo el permiso de gestionar usuarios' using errcode = '22023'; end if;
  -- ¿quedaria alguien activo que pueda gestionar usuarios?
  select count(*) into v_quedan from perfiles p
   where p.user_id <> p_user_id and p.activo
     and exists (select 1 from perfil_permiso pp where pp.perfil_id = p.perfil_id and pp.permiso = 'admin.usuarios');
  if coalesce(p_activo, true) and exists (select 1 from perfil_permiso pp where pp.perfil_id = p_perfil_id and pp.permiso = 'admin.usuarios') then v_quedan := v_quedan + 1; end if;
  if v_quedan < 1 then raise exception 'debe quedar al menos un usuario activo que pueda gestionar usuarios' using errcode = '22023'; end if;
  update perfiles set nombre = btrim(p_nombre), perfil_id = p_perfil_id, rol = v_nivel, sede_id = p_sede_id, activo = coalesce(p_activo, true) where user_id = p_user_id;
end
$fn$;

-- El usuario ya cambio su contrasena temporal
create or replace function usuario_clave_cambiada() returns void
language sql security definer set search_path = public as $fn$
  update perfiles set debe_cambiar_clave = false where user_id = auth.uid()
$fn$;

-- Crea o edita un perfil y sus permisos. p_id null = crear.
create or replace function perfil_guardar(p_id int, p_clave text, p_nombre text, p_descripcion text, p_nivel text, p_permisos text[])
returns int language plpgsql security definer set search_path = public as $fn$
declare v_id int; v_sis boolean; v_clave text; v_malos text[];
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para gestionar perfiles' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_nombre, '')), '') is null then raise exception 'falta el nombre del perfil' using errcode = '22023'; end if;
  if p_nivel not in ('admin', 'pagos', 'sede') then raise exception 'nivel invalido' using errcode = '22023'; end if;
  select array_agg(x) into v_malos from unnest(coalesce(p_permisos, '{}')) x where x not in (select permiso from permiso_catalogo);
  if v_malos is not null then raise exception 'permisos que no existen: %', v_malos using errcode = '22023'; end if;
  if p_nivel <> 'admin' and 'admin.usuarios' = any (coalesce(p_permisos, '{}')) then raise exception 'solo un perfil de nivel administrador puede gestionar usuarios' using errcode = '22023'; end if;
  if p_id is null then
    v_clave := lower(regexp_replace(btrim(coalesce(nullif(p_clave, ''), p_nombre)), '[^a-zA-Z0-9]+', '_', 'g'));
    if v_clave = '' then raise exception 'clave invalida' using errcode = '22023'; end if;
    insert into perfil_acceso (clave, nombre, descripcion, nivel, sistema) values (v_clave, btrim(p_nombre), p_descripcion, p_nivel, false) returning id into v_id;
  else
    select sistema into v_sis from perfil_acceso where id = p_id;
    if v_sis is null then raise exception 'el perfil no existe' using errcode = '22023'; end if;
    -- los de origen no cambian de nivel; uno con usuarios tampoco (les cambiaria lo que ven en el servidor sin que se den cuenta)
    if p_nivel <> (select nivel from perfil_acceso where id = p_id) then
      if v_sis then raise exception 'los perfiles de origen no cambian de nivel' using errcode = '22023'; end if;
      if exists (select 1 from perfiles where perfil_id = p_id) then raise exception 'el perfil tiene usuarios: no se le puede cambiar el nivel' using errcode = '22023'; end if;
    end if;
    -- nadie se puede quedar sin poder gestionar usuarios
    if not ('admin.usuarios' = any (coalesce(p_permisos, '{}'))) and exists (select 1 from perfil_permiso where perfil_id = p_id and permiso = 'admin.usuarios')
       and not exists (select 1 from perfiles p where p.activo and p.perfil_id <> p_id and exists (select 1 from perfil_permiso pp where pp.perfil_id = p.perfil_id and pp.permiso = 'admin.usuarios')) then
      raise exception 'debe quedar al menos un perfil con permiso de gestionar usuarios' using errcode = '22023';
    end if;
    update perfil_acceso set nombre = btrim(p_nombre), descripcion = p_descripcion, nivel = p_nivel where id = p_id;
    v_id := p_id;
  end if;
  delete from perfil_permiso where perfil_id = v_id;
  insert into perfil_permiso (perfil_id, permiso) select v_id, x from unnest(coalesce(p_permisos, '{}')) x group by x;
  return v_id;
end
$fn$;

create or replace function perfil_eliminar(p_id int) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para gestionar perfiles' using errcode = '42501'; end if;
  if (select sistema from perfil_acceso where id = p_id) is not false then raise exception 'los perfiles de origen no se borran' using errcode = '22023'; end if;
  if exists (select 1 from perfiles where perfil_id = p_id) then raise exception 'hay usuarios con este perfil: cambialos de perfil primero' using errcode = '22023'; end if;
  delete from perfil_acceso where id = p_id;
end
$fn$;

revoke all on function usuario_puede_gestionar(), usuarios_listar(), usuario_registrar(uuid, text, int, int, boolean), usuario_actualizar(uuid, text, int, int, boolean),
  usuario_clave_cambiada(), perfil_guardar(int, text, text, text, text, text[]), perfil_eliminar(int) from public, anon;
grant execute on function usuario_puede_gestionar(), usuarios_listar(), usuario_registrar(uuid, text, int, int, boolean), usuario_actualizar(uuid, text, int, int, boolean),
  usuario_clave_cambiada(), perfil_guardar(int, text, text, text, text, text[]), perfil_eliminar(int) to authenticated;
grant execute on function usuario_registrar(uuid, text, int, int, boolean), usuario_actualizar(uuid, text, int, int, boolean) to service_role;

-- Marca que el usuario debe cambiar su contrasena en el proximo ingreso (se usa al restablecerla)
create or replace function usuario_forzar_cambio(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para gestionar usuarios' using errcode = '42501'; end if;
  update perfiles set debe_cambiar_clave = true where user_id = p_user_id;
  if not found then raise exception 'el usuario no existe' using errcode = '22023'; end if;
end
$fn$;
revoke all on function usuario_forzar_cambio(uuid) from public, anon;
grant execute on function usuario_forzar_cambio(uuid) to authenticated, service_role;
