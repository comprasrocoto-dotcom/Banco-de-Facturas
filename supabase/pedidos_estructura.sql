
-- ================= PAGINA DE PEDIDOS (misma base del banco) =================

create table if not exists proveedores (
  id                bigserial primary key,
  id_planilla       text,
  nit               text unique,
  razon_social      text,
  nombre_comercial  text,
  telefono1         text,
  telefono2         text,
  correo            text,
  asesor            text,
  created_at        timestamptz not null default now()
);

create table if not exists articulos (
  id                 bigserial primary key,
  codigo_barras      text unique,
  codigo_referencia  text,
  subfamilia         text,
  articulo_hiopos    text,
  unimedida_hiopos   text,
  articulo_comercial text,
  unimedida_compra   text,
  minimo             numeric,
  maximo             numeric,
  created_at         timestamptz not null default now()
);

create table if not exists catalogo_compras (
  id                bigserial primary key,
  codigo_barras     text,
  id_proveedor      bigint references proveedores(id) on delete set null,
  prioridad         int,
  precio_negociado  numeric(14,2),
  estado            text not null default 'Aprobado',
  created_at        timestamptz not null default now()
);
create index if not exists idx_cat_barras on catalogo_compras (codigo_barras);

create table if not exists unidades_medida (
  id       bigserial primary key,
  formato  text unique,
  medida   numeric,
  unidad   text
);

create table if not exists maximos_minimos (
  id           bigserial primary key,
  almacen      text,
  articulo     text,
  subarticulo  text,
  variacion    numeric,
  margen       numeric,
  minimo       numeric,
  maximo       numeric,
  created_at   timestamptz not null default now()
);
create index if not exists idx_minmax on maximos_minimos (almacen, articulo);

-- ---- pedidos: le agrego todo lo que trae la planilla BASE DE PEDIDOS ----
alter table pedidos add column if not exists responsable           text;
alter table pedidos add column if not exists tipo                  text default 'Requisicion';
alter table pedidos add column if not exists fecha_entrega         date;
alter table pedidos add column if not exists numero_factura        text;
alter table pedidos add column if not exists forma_pago            text;
alter table pedidos add column if not exists observacion_pedido    text;
alter table pedidos add column if not exists observacion_factura   text;
alter table pedidos add column if not exists numero_nota_credito   text;
alter table pedidos add column if not exists sede_texto            text;
alter table pedidos add column if not exists proveedor_texto       text;

-- ---- lineas del pedido (una fila por articulo, como la planilla) ----
create table if not exists pedido_lineas (
  id          bigserial primary key,
  pedido_id   bigint references pedidos(id) on delete cascade,
  codigo      text,
  insumo      text,
  cantidad    numeric,
  subfamilia  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_linea_pedido on pedido_lineas (pedido_id);
create index if not exists idx_linea_codigo on pedido_lineas (codigo);

-- ---- sedes: direccion, horario y telefono (hoja SEDE) ----
alter table sedes add column if not exists direccion    text;
alter table sedes add column if not exists hora_entrega text;
alter table sedes add column if not exists telefono     text;

-- ---- seguridad ----
alter table proveedores      enable row level security;
alter table articulos        enable row level security;
alter table catalogo_compras enable row level security;
alter table unidades_medida  enable row level security;
alter table maximos_minimos  enable row level security;
alter table pedido_lineas    enable row level security;

do $p$
declare t text;
begin
  foreach t in array array['proveedores','articulos','catalogo_compras','unidades_medida','maximos_minimos'] loop
    execute format('drop policy if exists %I_ver on %I', t, t);
    execute format('create policy %I_ver on %I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_admin on %I', t, t);
    execute format('create policy %I_admin on %I for all to authenticated using (mi_rol() in (''admin'',''pagos'')) with check (mi_rol() in (''admin'',''pagos''))', t, t);
  end loop;
  execute 'drop policy if exists linea_ver on pedido_lineas';
  execute 'create policy linea_ver on pedido_lineas for select to authenticated using (
             mi_rol() in (''admin'',''pagos'') or pedido_id in (
               select id from pedidos where sede_id = mi_sede() or marca_id = mi_marca()))';
  execute 'drop policy if exists linea_admin on pedido_lineas';
  execute 'create policy linea_admin on pedido_lineas for all to authenticated using (
             mi_rol() in (''admin'',''pagos'')) with check (mi_rol() in (''admin'',''pagos''))';
end $p$;
