-- ============================================================
-- Cambiar el CODIGO de un articulo desde Admin (26/09/2026). ADITIVO: una tabla de historial y una funcion; no toca nada existente.
-- El codigo (articulos.codigo_barras) se guarda como TEXTO en otras tablas (sin llave foranea), asi que cambiarlo solo en `articulos`
-- dejaria huerfanos los amarres a proveedores (con sus precios), el historial de precios y las lineas de los pedidos.
-- La funcion lo cambia en TODAS a la vez (una transaccion: o se cambia todo o nada) y deja constancia para poder revertirlo.
-- ============================================================
create table if not exists articulo_codigo_historial (
  id bigserial primary key,
  articulo_id bigint not null,
  codigo_anterior text not null,
  codigo_nuevo text not null,
  cambiado_por uuid,
  cambiado_en timestamptz not null default now(),
  filas jsonb not null default '{}'::jsonb   -- cuantas filas se actualizaron en cada tabla
);
alter table articulo_codigo_historial enable row level security;
drop policy if exists articulo_codigo_historial_ver on articulo_codigo_historial;
create policy articulo_codigo_historial_ver on articulo_codigo_historial for select to authenticated using (mi_rol() in ('admin','pagos'));

create or replace function articulo_cambiar_codigo(p_id bigint, p_nuevo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_viejo text; v_nuevo text; n_cat int; n_lin int; n_pre int;
begin
  if mi_rol() not in ('admin','pagos') then raise exception 'Sin permiso para cambiar el código de un artículo.'; end if;
  v_nuevo := upper(regexp_replace(btrim(coalesce(p_nuevo,'')), '\s+', '', 'g'));
  if v_nuevo = '' then raise exception 'El código no puede quedar vacío.'; end if;
  if length(v_nuevo) > 40 then raise exception 'El código es demasiado largo (máx. 40 caracteres).'; end if;
  select codigo_barras into v_viejo from articulos where id = p_id for update;
  if not found then raise exception 'El artículo no existe.'; end if;
  if v_nuevo = v_viejo then return jsonb_build_object('cambio', false, 'codigo', v_viejo); end if;
  if exists (select 1 from articulos where codigo_barras = v_nuevo) then raise exception 'Ya existe otro artículo con el código %.', v_nuevo; end if;
  if exists (select 1 from catalogo_compras where codigo_barras = v_nuevo) then raise exception 'El código % ya está amarrado a proveedores en el catálogo.', v_nuevo; end if;

  update articulos set codigo_barras = v_nuevo where id = p_id;
  update catalogo_compras set codigo_barras = v_nuevo where codigo_barras = v_viejo;   get diagnostics n_cat = row_count;
  update pedido_lineas set codigo = v_nuevo where codigo = v_viejo;                    get diagnostics n_lin = row_count;
  update precio_historial set codigo = v_nuevo where codigo = v_viejo;                 get diagnostics n_pre = row_count;

  insert into articulo_codigo_historial(articulo_id, codigo_anterior, codigo_nuevo, cambiado_por, filas)
    values (p_id, v_viejo, v_nuevo, auth.uid(), jsonb_build_object('catalogo_compras', n_cat, 'pedido_lineas', n_lin, 'precio_historial', n_pre));
  return jsonb_build_object('cambio', true, 'anterior', v_viejo, 'codigo', v_nuevo, 'catalogo_compras', n_cat, 'pedido_lineas', n_lin, 'precio_historial', n_pre);
end $$;
revoke all on function articulo_cambiar_codigo(bigint, text) from public, anon;
grant execute on function articulo_cambiar_codigo(bigint, text) to authenticated;
