-- ============================================================
--  CODIGO DEL ERP POR MARCA para articulos COMPARTIDOS de la lista general (15/10/2026, pedido del usuario)
-- ============================================================
-- El mismo articulo (lista general) puede tener otro codigo en el ERP de una marca (123 wok, Casa de Nadie...). Se guarda aqui
-- y SOLO se usa al ir al ERP (CSV del robot y ⬇ CSV de la web): en la web el articulo sigue con su codigo general.
-- Sin fila para una marca = se usa el codigo general (como antes). Solo aditivo: tabla nueva.
create table if not exists articulo_codigo_marca (
  id          bigserial primary key,
  articulo_id bigint not null references articulos(id) on delete cascade,
  marca_id    bigint not null references marcas(id),
  codigo      text not null check (codigo ~ '^[A-Z0-9_.-]{1,40}$'),
  creado_por  text,
  creado_en   timestamptz not null default now(),
  constraint articulo_codigo_marca_unica unique (articulo_id, marca_id),
  constraint articulo_codigo_marca_codigo_unico unique (marca_id, codigo)
);
create index if not exists articulo_codigo_marca_marca on articulo_codigo_marca (marca_id);

alter table articulo_codigo_marca enable row level security;
drop policy if exists acm_leer on articulo_codigo_marca;
create policy acm_leer on articulo_codigo_marca for select to authenticated using (true);
drop policy if exists acm_editar on articulo_codigo_marca;
create policy acm_editar on articulo_codigo_marca for all to authenticated
  using (mi_rol() = any (array['admin', 'pagos'])) with check (mi_rol() = any (array['admin', 'pagos']));
revoke all on articulo_codigo_marca from anon;
grant select, insert, update, delete on articulo_codigo_marca to authenticated;
grant usage, select on sequence articulo_codigo_marca_id_seq to authenticated;
