-- ============================================================
--  UNIDADES DE COMPRA + APRENDIZAJE CONTROLADO   (18/09/2026)
--  SOLO ADITIVO e idempotente: no borra, no modifica tablas existentes.
--  Tablas nuevas: unidad_catalogo, unidad_alias, regla_unidad, unidad_revision,
--  unidad_evento + vista regla_unidad_resumen + funcion unidad_registrar_correccion.
--  La semilla del final se genera desde lib/unidades.js (funcion sqlSeed).
-- ============================================================

-- 1) Catalogo de unidades y alias (ampliable: basta agregar filas)
create table if not exists unidad_catalogo (
  canon       text primary key,
  nombre      text not null,
  familia     text not null check (familia in ('masa','volumen','conteo','empaque')),
  base        text,            -- g | ml | und (null en empaques)
  factor_base numeric,         -- unidades base que tiene 1 de esta unidad
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
create table if not exists unidad_alias (
  alias     text primary key,  -- MAYUSCULAS sin tildes
  canon     text not null references unidad_catalogo(canon),
  origen    text not null default 'seed' check (origen in ('seed','manual','aprendido')),
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

-- 2) Reglas aprendidas de correcciones humanas (una fila por clave + unidad decidida)
--    clave = proveedor(NIT o nombre) | producto normalizado | presentacion
create table if not exists regla_unidad (
  id                   bigserial primary key,
  clave                text not null,
  proveedor_nit        text,
  proveedor_nombre     text,
  producto_norm        text not null,
  descripcion_original text,
  presentacion         text,
  unidad_original      text,      -- lo que el agente habia interpretado
  unidad_decidida      text not null references unidad_catalogo(canon),
  factor_conversion    numeric,   -- opcional (ej. 12 = una caja trae 12 unidades)
  confirmaciones       int not null default 1 check (confirmaciones >= 1),
  confirmada_admin     boolean not null default false,
  corregido_por        text,
  primera_en           timestamptz not null default now(),
  ultima_en            timestamptz not null default now(),
  unique (clave, unidad_decidida)
);
create index if not exists ix_regla_unidad_clave on regla_unidad (clave);

-- 3) Cola de revision humana: el agente NO invento la unidad y pide que alguien decida
create table if not exists unidad_revision (
  id                   bigserial primary key,
  clave                text not null,
  proveedor_nit        text,
  proveedor_nombre     text,
  producto_norm        text,
  descripcion_original text,
  presentacion         text,
  motivo               text not null,
  sugerencia           text,
  estado               text not null default 'pendiente' check (estado in ('pendiente','resuelta','descartada')),
  factura_cufe         text,
  pedido_numero        text,
  orden_id             bigint,
  creado_en            timestamptz not null default now(),
  resuelta_en          timestamptz,
  resuelta_por         text,
  unidad_resuelta      text
);
create unique index if not exists ux_unidad_revision_pendiente on unidad_revision (clave) where estado = 'pendiente';

-- 4) Auditoria: que decidio el agente, por que, con que informacion y si un humano corrigio
create table if not exists unidad_evento (
  id             bigserial primary key,
  clave          text,
  tipo           text not null check (tipo in ('decision_agente','correccion_usuario','confirmacion_admin','revision_solicitada')),
  unidad_agente  text,
  unidad_usuario text,
  fuente         text,            -- regla | catalogo | presentacion | revision
  confianza      text,
  detalle        jsonb,           -- descripcion original, traza de consulta, presentacion, etc.
  usuario        text,
  factura_cufe   text,
  pedido_numero  text,
  orden_id       bigint,
  creado_en      timestamptz not null default now()
);
create index if not exists ix_unidad_evento_clave on unidad_evento (clave);
create index if not exists ix_unidad_evento_tipo  on unidad_evento (tipo, creado_en desc);

-- 5) Vista de confianza: 1-2 confirmaciones = baja, 3-4 = media, 5+ = alta (con >=80% de consistencia).
--    Confirmada por admin = alta. Si la ultima decision contradice a la dominante = contradictoria.
create or replace view regla_unidad_resumen with (security_invoker = true) as
with base as (
  select r.*,
         sum(confirmaciones) over (partition by clave) as total_clave,
         row_number() over (partition by clave order by confirmada_admin desc, confirmaciones desc, ultima_en desc, id desc) as rn_dom,
         row_number() over (partition by clave order by ultima_en desc, id desc) as rn_ult
  from regla_unidad r
), dom as (select * from base where rn_dom = 1),
   ult as (select clave, unidad_decidida as ultima_unidad from base where rn_ult = 1),
calc as (
  select d.clave, d.proveedor_nit, d.proveedor_nombre, d.producto_norm, d.descripcion_original, d.presentacion,
         d.unidad_decidida as unidad, d.unidad_original, d.factor_conversion,
         d.confirmaciones as n, (d.total_clave - d.confirmaciones)::int as contradicciones,
         d.confirmada_admin, d.corregido_por, d.ultima_en, u.ultima_unidad,
         (d.confirmaciones::numeric / d.total_clave) as consistencia
  from dom d join ult u using (clave)
)
select clave, proveedor_nit, proveedor_nombre, producto_norm, descripcion_original, presentacion,
       unidad, unidad_original, factor_conversion, n, contradicciones, confirmada_admin, corregido_por, ultima_en,
       case when confirmada_admin then 'alta'
            when n >= 5 and consistencia >= 0.8 then 'alta'
            when n >= 3 and consistencia >= 0.8 then 'media'
            else 'baja' end as nivel,
       case when ultima_unidad <> unidad then 'contradictoria'
            when not confirmada_admin and contradicciones > 0 and consistencia < 0.8 then 'contradictoria'
            when confirmada_admin or (n >= 5 and consistencia >= 0.8) then 'confirmada'
            else 'activa' end as estado,
       (ultima_unidad <> unidad
        or (not confirmada_admin and contradicciones > 0 and consistencia < 0.8)
        or not (confirmada_admin or n >= 3)) as requiere_revision
from calc;

-- 6) Registrar una correccion (un solo lugar con la logica de conteo; lo usan la web y el agente)
create or replace function unidad_registrar_correccion(
  p_clave text, p_prov_nit text, p_prov_nombre text, p_producto_norm text, p_descripcion text,
  p_presentacion text, p_unidad_agente text, p_unidad_usuario text, p_usuario text,
  p_admin boolean default false, p_revision_id bigint default null, p_factura text default null,
  p_pedido text default null, p_orden bigint default null, p_factor numeric default null
) returns bigint language plpgsql security definer set search_path = public as $fn$
declare v_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then
    raise exception 'sin permiso para registrar correcciones de unidad';
  end if;
  if not exists (select 1 from unidad_catalogo where canon = p_unidad_usuario and activo) then
    raise exception 'unidad desconocida: %', p_unidad_usuario;
  end if;
  insert into regla_unidad (clave, proveedor_nit, proveedor_nombre, producto_norm, descripcion_original, presentacion,
                            unidad_original, unidad_decidida, factor_conversion, confirmada_admin, corregido_por, primera_en, ultima_en)
  values (p_clave, p_prov_nit, p_prov_nombre, p_producto_norm, p_descripcion, p_presentacion,
          p_unidad_agente, p_unidad_usuario, p_factor, coalesce(p_admin, false), p_usuario, clock_timestamp(), clock_timestamp())
  on conflict (clave, unidad_decidida) do update set
    confirmaciones    = regla_unidad.confirmaciones + 1,
    ultima_en         = clock_timestamp(),
    confirmada_admin  = regla_unidad.confirmada_admin or excluded.confirmada_admin,
    corregido_por     = excluded.corregido_por,
    factor_conversion = coalesce(excluded.factor_conversion, regla_unidad.factor_conversion)
  returning id into v_id;
  insert into unidad_evento (clave, tipo, unidad_agente, unidad_usuario, fuente, detalle, usuario, factura_cufe, pedido_numero, orden_id, creado_en)
  values (p_clave, case when coalesce(p_admin,false) then 'confirmacion_admin' else 'correccion_usuario' end,
          p_unidad_agente, p_unidad_usuario, 'usuario',
          jsonb_build_object('descripcion', p_descripcion, 'presentacion', p_presentacion, 'proveedor', p_prov_nombre),
          p_usuario, p_factura, p_pedido, p_orden, clock_timestamp());
  if p_revision_id is not null then
    update unidad_revision set estado = 'resuelta', resuelta_en = now(), resuelta_por = p_usuario, unidad_resuelta = p_unidad_usuario
     where id = p_revision_id and estado = 'pendiente';
  end if;
  return v_id;
end $fn$;
revoke all on function unidad_registrar_correccion(text,text,text,text,text,text,text,text,text,boolean,bigint,text,text,bigint,numeric) from public, anon;
grant execute on function unidad_registrar_correccion(text,text,text,text,text,text,text,text,text,boolean,bigint,text,text,bigint,numeric) to authenticated, service_role;

-- 7) Seguridad (RLS). El agente usa la service key (no pasa por RLS).
alter table unidad_catalogo  enable row level security;
alter table unidad_alias     enable row level security;
alter table regla_unidad     enable row level security;
alter table unidad_revision  enable row level security;
alter table unidad_evento    enable row level security;

drop policy if exists unidad_catalogo_leer on unidad_catalogo;
create policy unidad_catalogo_leer on unidad_catalogo for select to authenticated using (true);
drop policy if exists unidad_alias_leer on unidad_alias;
create policy unidad_alias_leer on unidad_alias for select to authenticated using (true);
drop policy if exists unidad_alias_admin on unidad_alias;
create policy unidad_alias_admin on unidad_alias for all to authenticated using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists regla_unidad_leer on regla_unidad;
create policy regla_unidad_leer on regla_unidad for select to authenticated using (mi_rol() in ('admin','pagos'));
drop policy if exists unidad_revision_leer on unidad_revision;
create policy unidad_revision_leer on unidad_revision for select to authenticated using (mi_rol() in ('admin','pagos'));
drop policy if exists unidad_evento_leer on unidad_evento;
create policy unidad_evento_leer on unidad_evento for select to authenticated using (mi_rol() in ('admin','pagos'));

-- 8) Semilla (generada desde lib/unidades.js)
insert into unidad_catalogo (canon, nombre, familia, base, factor_base) values
  ('KG', 'Kilogramo', 'masa', 'g', 1000),
  ('G', 'Gramo', 'masa', 'g', 1),
  ('LB', 'Libra', 'masa', 'g', 453.592),
  ('OZ', 'Onza', 'masa', 'g', 28.3495),
  ('L', 'Litro', 'volumen', 'ml', 1000),
  ('ML', 'Mililitro', 'volumen', 'ml', 1),
  ('UND', 'Unidad', 'conteo', 'und', 1),
  ('DOCENA', 'Docena', 'conteo', 'und', 12),
  ('CAJA', 'Caja', 'empaque', null, null),
  ('PAQUETE', 'Paquete', 'empaque', null, null),
  ('BOLSA', 'Bolsa', 'empaque', null, null),
  ('TARRO', 'Tarro', 'empaque', null, null),
  ('BIDON', 'Bidon', 'empaque', null, null),
  ('GALON', 'Galon', 'empaque', null, null),
  ('CANASTA', 'Canasta', 'empaque', null, null),
  ('BLOQUE', 'Bloque', 'empaque', null, null),
  ('BULTO', 'Bulto', 'empaque', null, null),
  ('LATA', 'Lata', 'empaque', null, null),
  ('ROLLO', 'Rollo', 'empaque', null, null),
  ('BARRIL', 'Barril', 'empaque', null, null),
  ('SIXPACK', 'Sixpack', 'empaque', null, null),
  ('BOTELLA', 'Botella', 'empaque', null, null),
  ('PACA', 'Paca', 'empaque', null, null),
  ('GARRAFA', 'Garrafa', 'empaque', null, null)
on conflict (canon) do nothing;

insert into unidad_alias (alias, canon) values
  ('KG', 'KG'),
  ('KGS', 'KG'),
  ('KILO', 'KG'),
  ('KILOS', 'KG'),
  ('KILOGRAMO', 'KG'),
  ('KILOGRAMOS', 'KG'),
  ('KL', 'KG'),
  ('K', 'KG'),
  ('G', 'G'),
  ('GR', 'G'),
  ('GRS', 'G'),
  ('GRAMO', 'G'),
  ('GRAMOS', 'G'),
  ('LB', 'LB'),
  ('LBS', 'LB'),
  ('LIBRA', 'LB'),
  ('LIBRAS', 'LB'),
  ('OZ', 'OZ'),
  ('ONZ', 'OZ'),
  ('ONZA', 'OZ'),
  ('ONZAS', 'OZ'),
  ('L', 'L'),
  ('LT', 'L'),
  ('LTS', 'L'),
  ('LTR', 'L'),
  ('LITRO', 'L'),
  ('LITROS', 'L'),
  ('ML', 'ML'),
  ('MLS', 'ML'),
  ('MILILITRO', 'ML'),
  ('MILILITROS', 'ML'),
  ('CC', 'ML'),
  ('UND', 'UND'),
  ('UNDS', 'UND'),
  ('UN', 'UND'),
  ('U', 'UND'),
  ('UNI', 'UND'),
  ('UNID', 'UND'),
  ('UNIDAD', 'UND'),
  ('UNIDADES', 'UND'),
  ('UDS', 'UND'),
  ('PC', 'UND'),
  ('PCS', 'UND'),
  ('PZA', 'UND'),
  ('PZAS', 'UND'),
  ('PIEZA', 'UND'),
  ('PIEZAS', 'UND'),
  ('DOC', 'DOCENA'),
  ('DOCENA', 'DOCENA'),
  ('DOCENAS', 'DOCENA'),
  ('CAJA', 'CAJA'),
  ('CAJAS', 'CAJA'),
  ('CJ', 'CAJA'),
  ('CJA', 'CAJA'),
  ('PAQUETE', 'PAQUETE'),
  ('PAQUETES', 'PAQUETE'),
  ('PAQ', 'PAQUETE'),
  ('PQT', 'PAQUETE'),
  ('PQTE', 'PAQUETE'),
  ('BOLSA', 'BOLSA'),
  ('BOLSAS', 'BOLSA'),
  ('BLS', 'BOLSA'),
  ('TARRO', 'TARRO'),
  ('TARROS', 'TARRO'),
  ('BIDON', 'BIDON'),
  ('BIDONES', 'BIDON'),
  ('GALON', 'GALON'),
  ('GALONES', 'GALON'),
  ('GAL', 'GALON'),
  ('CANASTA', 'CANASTA'),
  ('CANASTAS', 'CANASTA'),
  ('CANASTILLA', 'CANASTA'),
  ('BLOQUE', 'BLOQUE'),
  ('BLOQUES', 'BLOQUE'),
  ('BLQ', 'BLOQUE'),
  ('BULTO', 'BULTO'),
  ('BULTOS', 'BULTO'),
  ('LATA', 'LATA'),
  ('LATAS', 'LATA'),
  ('ROLLO', 'ROLLO'),
  ('ROLLOS', 'ROLLO'),
  ('BARRIL', 'BARRIL'),
  ('BARRILES', 'BARRIL'),
  ('SIXPACK', 'SIXPACK'),
  ('BOTELLA', 'BOTELLA'),
  ('BOTELLAS', 'BOTELLA'),
  ('VBOTELLA', 'BOTELLA'),
  ('PACA', 'PACA'),
  ('PACAS', 'PACA'),
  ('GARRAFA', 'GARRAFA'),
  ('GARRAFAS', 'GARRAFA')
on conflict (alias) do nothing;
