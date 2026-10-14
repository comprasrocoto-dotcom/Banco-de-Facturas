-- ============================================================
--  ARTICULO <-> MARCA (13/10/2026, pedido del usuario: "los articulos a la hora de editar tengan la misma opcion que proveedores")
-- ============================================================
-- La lista GENERAL de articulos la comparten las marcas sin lista propia (Arrebatao, 123 wok, Casa de Nadie, Rocoto).
-- Un articulo SIN filas aqui aparece en todas ellas (como siempre); con filas, solo en esas marcas al hacer pedidos.
-- Las marcas con lista propia (Sin Par) no usan esta tabla (sus articulos estan en marca_articulo, con sus codigos).
-- Solo aditivo: tabla nueva.
create table if not exists articulo_marca (
  id          bigserial primary key,
  articulo_id bigint not null references articulos (id) on delete cascade,
  marca_id    integer not null references marcas (id),
  origen      text,
  creado_en   timestamptz not null default now(),
  unique (articulo_id, marca_id)
);
create index if not exists ix_articulo_marca_marca on articulo_marca (marca_id);
alter table articulo_marca enable row level security;
drop policy if exists articulo_marca_ver on articulo_marca;
create policy articulo_marca_ver on articulo_marca for select to authenticated using (true);
drop policy if exists articulo_marca_admin on articulo_marca;
create policy articulo_marca_admin on articulo_marca for all to authenticated
  using (mi_rol() = any (array['admin', 'pagos'])) with check (mi_rol() = any (array['admin', 'pagos']));
