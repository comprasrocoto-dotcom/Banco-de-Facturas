-- ============================================================
--  BANCO DE FACTURAS - esquema Supabase (idempotente: se puede correr N veces)
--  Flujo: pool -> la sede la toma -> sella y aprueba -> pagos
--  Llave de oro: el CUFE es unico (no se puede duplicar).
-- ============================================================

-- ---------- tipos ----------
do $$ begin create type estado_factura as enum ('pool','asignada','sellada','pagada','rechazada'); exception when duplicate_object then null; end $$;
do $$ begin create type tipo_doc       as enum ('factura','nota_credito','cuenta_cobro','otro');  exception when duplicate_object then null; end $$;
do $$ begin create type categoria_doc  as enum ('insumos','empaque','aseo','loza_utensilios','otro'); exception when duplicate_object then null; end $$;

-- ---------- tablas ----------
create table if not exists marcas (
  id serial primary key,
  nombre text unique not null,
  nit text
);

create table if not exists sedes (
  id serial primary key,
  marca_id int not null references marcas(id) on delete cascade,
  nombre text not null,
  direccion text,
  unique (marca_id, nombre)
);

create table if not exists perfiles (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  nombre   text,
  rol      text not null default 'sede',
  sede_id  int references sedes(id) on delete set null,
  activo   boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists facturas (
  cufe            text primary key,
  marca_id        int not null references marcas(id),
  tipo            tipo_doc not null default 'factura',
  categoria       categoria_doc not null default 'otro',
  prefijo         text,
  folio           text,
  documento       text,
  emisor          text,
  nit_emisor      text,
  nit_receptor    text,
  fecha_emision   date,
  fecha_recepcion timestamptz,
  total           numeric(14,2),
  iva             numeric(14,2),
  estado          estado_factura not null default 'pool',
  sede_id         int references sedes(id),
  asignada_por    uuid references auth.users(id),
  asignada_en     timestamptz,
  sellada_por     uuid references auth.users(id),
  sellada_en      timestamptz,
  archivo_pdf     text,
  archivo_xml     text,
  created_at      timestamptz not null default now()
);
alter table facturas add column if not exists categoria categoria_doc not null default 'otro';

create table if not exists novedades (
  id         bigserial primary key,
  cufe       text not null references facturas(cufe) on delete cascade,
  motivo     text,
  texto      text,
  foto       text,
  usuario    uuid references auth.users(id),
  sede_id    int references sedes(id),
  created_at timestamptz not null default now()
);

create table if not exists historial (
  id         bigserial primary key,
  cufe       text references facturas(cufe) on delete cascade,
  accion     text not null,
  de         text,
  a          text,
  detalle    text,
  usuario    uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists categorias_proveedor (
  nit       text primary key,
  nombre    text,
  categoria categoria_doc not null,
  nota      text,
  actualizado timestamptz not null default now()
);

create index if not exists idx_fact_estado    on facturas (marca_id, estado);
create index if not exists idx_fact_sede      on facturas (sede_id, estado);
create index if not exists idx_fact_emisor    on facturas (nit_emisor);
create index if not exists idx_fact_categoria on facturas (categoria);
create index if not exists idx_nov_cufe       on novedades (cufe);

-- ---------- la pagina solo muestra estas 4 categorias ----------
create or replace view facturas_visibles as
  select * from facturas where categoria in ('insumos','empaque','aseo','loza_utensilios');

-- ---------- seguridad (RLS) ----------
alter table facturas  enable row level security;
alter table novedades enable row level security;
alter table perfiles  enable row level security;

create or replace function mi_rol() returns text language sql stable security definer as
  $$ select coalesce((select rol from perfiles where user_id = auth.uid()), 'sede') $$;
create or replace function mi_sede() returns int language sql stable security definer as
  $$ select sede_id from perfiles where user_id = auth.uid() $$;
create or replace function mi_marca() returns int language sql stable security definer as
  $$ select s.marca_id from perfiles p join sedes s on s.id = p.sede_id where p.user_id = auth.uid() $$;

drop policy if exists fact_admin on facturas;
drop policy if exists fact_sede  on facturas;
drop policy if exists fact_tomar on facturas;
create policy fact_admin on facturas for select using (mi_rol() in ('admin','pagos'));
create policy fact_sede  on facturas for select using (
  mi_rol() = 'sede' and (sede_id = mi_sede() or (estado = 'pool' and marca_id = mi_marca())));
create policy fact_tomar on facturas for update using (
  mi_rol() = 'sede' and (sede_id = mi_sede() or (estado = 'pool' and marca_id = mi_marca())))
  with check (sede_id = mi_sede());

drop policy if exists nov_admin  on novedades;
drop policy if exists nov_sede   on novedades;
drop policy if exists nov_insert on novedades;
create policy nov_admin  on novedades for select using (mi_rol() in ('admin','pagos'));
create policy nov_sede   on novedades for select using (
  mi_rol() = 'sede' and cufe in (select cufe from facturas where sede_id = mi_sede()));
create policy nov_insert on novedades for insert with check (
  mi_rol() in ('admin','pagos') or cufe in (select cufe from facturas where sede_id = mi_sede()));

drop policy if exists perfil_propio on perfiles;
create policy perfil_propio on perfiles for select using (user_id = auth.uid() or mi_rol() = 'admin');

-- ---------- storage (PDF privados) ----------
insert into storage.buckets (id, name, public) values ('facturas','facturas',false)
  on conflict (id) do nothing;

drop policy if exists archivo_leer  on storage.objects;
drop policy if exists archivo_subir on storage.objects;
create policy archivo_leer  on storage.objects for select using (bucket_id='facturas' and auth.role()='authenticated');
create policy archivo_subir on storage.objects for insert with check (bucket_id='facturas' and auth.role()='authenticated');

-- ---------- datos base ----------
insert into marcas (nombre, nit) values
  ('Arrebatao','901363438'), ('123 wok',null), ('Casa de Nadie',null), ('Sin Par',null)
  on conflict (nombre) do nothing;

insert into categorias_proveedor (nit, nombre, categoria) values
  ('811033374','LEGUMBRES HERIBERTO MONTES BEDOYA S.A.S','insumos'),
  ('811006789','JUAN D HOYOS DISTRIBUCIONES S.A.S.','loza_utensilios'),
  ('811021441','QUIMICA ACTIVA S.A.S.','aseo')
  on conflict (nit) do nothing;
