-- ============================================================
--  REGLAS DEL AGENTE POR MARCA  -  03/11/2026, pedido del usuario:
--  «quiero que el agente pueda aprender reglas por cada marca: en casi todas esta referencia se maneja en gramos/kilos, pero en
--   Arrebatao llega, se porciona y se ingresa en unidades, aunque el proveedor trae filete de atún»
-- ============================================================
-- Hasta hoy «Nombres por decidir» enseñaba un nombre POR PROVEEDOR para todas las marcas (tabla producto_alias). Ahora se puede
-- enseñar SOLO PARA UNA MARCA (o para todas) y, si hace falta, la EQUIVALENCIA de unidades de esa marca:
--   ej. Dulce Mar «FILETE DE ATUN LOMO EN TERO POR KG» en Arrebatao -> «ATUN POR 130 GRAMOS», 1 UNIDAD = 0,13 KILO.
-- El agente busca primero la regla de la marca del pedido, luego la de todas las marcas, y por ultimo lo enseñado antes
-- (producto_alias, que NO se toca). Con equivalencia: los kilos de la factura deben dar EXACTAMENTE las unidades del pedido;
-- si no, el documento NO se ingresa y queda en «Documentos con novedad» para revisarlo a mano (decision del usuario).
-- Solo AGREGA (1 tabla y 1 funcion). Repetirlo no hace nada.

create table if not exists public.producto_alias_marca (
  id bigserial primary key,
  proveedor_nit text not null,
  texto_norm text not null,
  marca_id integer references public.marcas(id),          -- vacio = todas las marcas
  nombre_pedido text not null,
  unidad_proveedor text,                                   -- como factura el proveedor (KILO, CAJA...); vacio = misma unidad
  factor_proveedor numeric check (factor_proveedor is null or factor_proveedor > 0),   -- cuantas del proveedor son 1 del pedido
  confirmaciones integer not null default 1,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists producto_alias_marca_unico on public.producto_alias_marca (proveedor_nit, texto_norm, (coalesce(marca_id, 0)));
alter table public.producto_alias_marca enable row level security;
drop policy if exists pam_leer on public.producto_alias_marca;
create policy pam_leer on public.producto_alias_marca for select to authenticated
  using ((select mi_rol() as mi_rol) = any (array['admin', 'pagos']));

create or replace function public.producto_alias_marca_registrar(
  p_proveedor_nit text, p_texto_norm text, p_marca_id integer, p_nombre_pedido text,
  p_unidad_proveedor text default null, p_factor_proveedor numeric default null,
  p_usuario text default null, p_revision_id bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_nit text; v_texto text; v_nombre text; v_unidad text; v_factor numeric; v_usuario text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Solo admin o pagos pueden enseñar reglas.' using errcode = '42501';
  end if;
  v_nit := nullif(regexp_replace(coalesce(p_proveedor_nit, ''), '\D', '', 'g'), '');
  if v_nit is null then raise exception 'Falta el NIT del proveedor.' using errcode = '22023'; end if;
  v_texto := nullif(btrim(coalesce(p_texto_norm, '')), '');
  if v_texto is null then raise exception 'Falta el texto de la factura.' using errcode = '22023'; end if;
  v_nombre := nullif(btrim(coalesce(p_nombre_pedido, '')), '');
  if v_nombre is null or length(v_nombre) > 200 then raise exception 'Di a que nombre del pedido corresponde (hasta 200 caracteres).' using errcode = '22023'; end if;
  if p_marca_id is not null and not exists (select 1 from marcas where id = p_marca_id) then raise exception 'La marca no existe.' using errcode = '22023'; end if;
  v_unidad := nullif(upper(btrim(coalesce(p_unidad_proveedor, ''))), '');
  v_factor := case when v_unidad is null then null else p_factor_proveedor end;
  if v_unidad is not null and (v_factor is null or v_factor <= 0) then raise exception 'La equivalencia tiene que ser un numero mayor que 0.' using errcode = '22023'; end if;
  if length(coalesce(v_unidad, '')) > 30 then raise exception 'La unidad del proveedor es demasiado larga.' using errcode = '22023'; end if;
  v_usuario := coalesce(nullif(btrim(p_usuario), ''), 'admin');

  insert into producto_alias_marca (proveedor_nit, texto_norm, marca_id, nombre_pedido, unidad_proveedor, factor_proveedor, creado_por)
  values (v_nit, v_texto, p_marca_id, v_nombre, v_unidad, v_factor, v_usuario)
  on conflict (proveedor_nit, texto_norm, (coalesce(marca_id, 0))) do update set
    nombre_pedido = excluded.nombre_pedido, unidad_proveedor = excluded.unidad_proveedor, factor_proveedor = excluded.factor_proveedor,
    confirmaciones = producto_alias_marca.confirmaciones + 1, actualizado_en = now()
  returning id into v_id;

  if p_revision_id is not null then
    update producto_revision set estado = 'resuelta', resuelta_en = now(), resuelta_por = v_usuario, nombre_resuelto = v_nombre
    where id = p_revision_id and estado = 'pendiente';
  end if;
  return v_id;
end $$;

revoke all on function public.producto_alias_marca_registrar(text, text, integer, text, text, numeric, text, bigint) from public, anon;
grant execute on function public.producto_alias_marca_registrar(text, text, integer, text, text, numeric, text, bigint) to authenticated, service_role;
grant select on public.producto_alias_marca to authenticated;
