-- ============================================================
--  REGLA: ciertos productos de UN proveedor van SIEMPRE en un pedido aparte  -  06/10/2026
--  Pedido del usuario: para JUAN D. HOYOS DISTRIBUCIONES S.A.S. (proveedores.id = 200), PAPA DELGADA 9X9 2KG
--  (articulos.id = 490, codigo 14886) y PAPA SURECRISP FLAVOR 7x7x2.27KG (articulos.id = 769, codigo 17550) van en un
--  PEDIDO ESPECIAL, separado de los demas productos. La condicion es PROVEEDOR + PRODUCTO (por ID, no por nombre):
--  el mismo producto con otro proveedor NO se separa. El precio no interviene.
--  Lo usa "Nuevo pedido" (index.html, guardarPedido + js/separar-pedido.js). Aditiva: no toca nada existente.
-- ============================================================
create table if not exists regla_pedido_aparte (
  id bigserial primary key,
  proveedor_id bigint not null references proveedores(id) on delete cascade,
  articulo_id bigint not null references articulos(id) on delete cascade,
  grupo text not null default 'PEDIDO ESPECIAL',   -- nombre del pedido aparte (los productos del mismo grupo van juntos)
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (proveedor_id, articulo_id)
);
alter table regla_pedido_aparte enable row level security;
drop policy if exists regla_pedido_aparte_ver on regla_pedido_aparte;
create policy regla_pedido_aparte_ver on regla_pedido_aparte for select to authenticated using (true);
drop policy if exists regla_pedido_aparte_admin on regla_pedido_aparte;
create policy regla_pedido_aparte_admin on regla_pedido_aparte for all to authenticated
  using (mi_rol() = any (array['admin','pagos'])) with check (mi_rol() = any (array['admin','pagos']));
grant select on regla_pedido_aparte to authenticated;

-- JUAN D. HOYOS DISTRIBUCIONES S.A.S. (200): papa delgada (490) y papa Surecrisp (769) -> un solo PEDIDO ESPECIAL
insert into regla_pedido_aparte (proveedor_id, articulo_id, grupo)
select 200, a.id, 'PEDIDO ESPECIAL' from articulos a
 where a.id in (490, 769)
   and exists (select 1 from proveedores p where p.id = 200 and p.razon_social = 'JUAN D. HOYOS DISTRIBUCIONES S.A.S.')
on conflict (proveedor_id, articulo_id) do nothing;
