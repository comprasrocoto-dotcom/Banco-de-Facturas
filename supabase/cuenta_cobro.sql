-- ============================================================
--  CUENTAS DE COBRO con foto (13/10/2026, pedido del usuario)
-- ============================================================
-- La sede toma una foto de la cuenta de cobro (proveedor sin factura electronica), digita el N°, la fecha y la
-- cantidad y el precio de cada articulo segun el papel, y queda amarrada al pedido. El agente la ingresa al ERP
-- igual que una factura de la DIAN, pero con las lineas digitadas (la foto no se puede leer como un PDF).
-- Solo cambios ADITIVOS: una tabla nueva y una funcion nueva. La cuenta se guarda en facturas con tipo
-- 'cuenta_cobro' (ya existia en el enum) y un cufe propio "CC-<nit>-<numero>" (los de la DIAN son 96 hex).

create table if not exists cuenta_cobro_linea (
  id              bigserial primary key,
  factura_cufe    text not null references facturas (cufe) on delete cascade,
  orden           integer not null,
  codigo          text,
  articulo        text not null,
  cantidad        numeric not null check (cantidad > 0),
  precio_unitario numeric not null check (precio_unitario >= 0),
  subtotal        numeric not null,
  creado_en       timestamptz not null default now()
);
create index if not exists ix_cuenta_cobro_linea_cufe on cuenta_cobro_linea (factura_cufe, orden);

alter table cuenta_cobro_linea enable row level security;
-- se ve con los mismos permisos que su factura (las politicas de facturas ya filtran por rol y sede)
drop policy if exists ccl_ver on cuenta_cobro_linea;
create policy ccl_ver on cuenta_cobro_linea for select to authenticated
  using (exists (select 1 from facturas f where f.cufe = cuenta_cobro_linea.factura_cufe));
-- nadie escribe directo: solo la funcion cuenta_cobro_amarrar (security definer)

-- Crea la cuenta de cobro (facturas + lineas) y la amarra al pedido con pedido_factura_amarrar (mismas reglas de
-- siempre: permisos, Fecha Recibido, centro de costo). Todo o nada. Devuelve el cufe.
create or replace function cuenta_cobro_amarrar(
  p_pedido_id bigint, p_numero text, p_fecha_recibido date, p_total numeric, p_foto text, p_lineas jsonb,
  p_centro_costo text default null, p_usuario text default null)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ped pedidos%rowtype; v_nit text; v_emisor text; v_num text; v_cufe text;
  v_suma numeric := 0; v_n integer := 0; l jsonb; v_cant numeric; v_precio numeric; v_art text;
begin
  select * into v_ped from pedidos where id = p_pedido_id;
  if not found then raise exception 'Ese pedido no existe.' using errcode = '22023'; end if;
  -- mismo permiso que el amarre normal, y un analista restringido solo en SUS sedes
  if coalesce(auth.role(), '') <> 'service_role'
     and mi_rol() not in ('admin', 'pagos')
     and not (mi_rol() = 'sede' and (v_ped.sede_id = mi_sede() or v_ped.marca_id = mi_marca())) then
    raise exception 'Sin permiso para amarrar este pedido.' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and analista_restringido() and not (v_ped.sede_id = any (analista_sedes())) then
    raise exception 'Ese pedido es de otra sede.' using errcode = '42501';
  end if;
  if v_ped.factura_cufe is not null then raise exception 'Ese pedido ya tiene una factura amarrada.' using errcode = '22023'; end if;
  v_num := upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_num = '' then raise exception 'Escribe el número de la cuenta de cobro.' using errcode = '22023'; end if;
  if coalesce(btrim(p_foto), '') = '' or p_foto not like 'cuentas_cobro/%' then raise exception 'Falta la foto de la cuenta de cobro.' using errcode = '22023'; end if;
  if p_total is null or p_total <= 0 then raise exception 'Escribe el total de la cuenta de cobro.' using errcode = '22023'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La cuenta de cobro no tiene artículos.' using errcode = '22023';
  end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_art := btrim(coalesce(l->>'articulo', ''));
    v_cant := nullif(l->>'cantidad', '')::numeric; v_precio := nullif(l->>'precio_unitario', '')::numeric;
    if v_art = '' or v_cant is null or v_cant <= 0 or v_precio is null or v_precio < 0 then
      raise exception 'Revisa los artículos: cada uno necesita cantidad mayor que 0 y precio.' using errcode = '22023';
    end if;
    v_suma := v_suma + round(v_cant * v_precio); v_n := v_n + 1;
  end loop;
  if abs(v_suma - p_total) > greatest(1, v_n) then
    raise exception 'Los artículos suman $ % y el total de la cuenta es $ %: revisa cantidades y precios.', replace(to_char(v_suma, 'FM999,999,999'), ',', '.'), replace(to_char(p_total, 'FM999,999,999'), ',', '.') using errcode = '22023';
  end if;
  -- el proveedor de la cuenta es el del pedido (el NIT igual al del pedido: el trigger de amarre lo exige)
  select nullif(btrim(pr.nit), ''), coalesce(nullif(btrim(pr.razon_social), ''), v_ped.proveedor_texto, v_ped.proveedor)
    into v_nit, v_emisor from proveedores pr where pr.id = v_ped.proveedor_id;
  v_nit := coalesce(nullif(btrim(v_ped.nit_proveedor), ''), v_nit);
  v_emisor := coalesce(v_emisor, v_ped.proveedor_texto, v_ped.proveedor);
  v_cufe := 'CC-' || coalesce(nullif(regexp_replace(coalesce(v_nit, ''), '[^0-9]', '', 'g'), ''), 'PED' || v_ped.id) || '-' || v_num;
  if exists (select 1 from facturas where cufe = v_cufe) then
    raise exception 'La cuenta de cobro % de este proveedor ya está registrada.', v_num using errcode = '23505';
  end if;
  -- ya recibida por la sede: queda sellada (no aparece en "ingresada sin sellar")
  insert into facturas (cufe, marca_id, tipo, categoria, documento, emisor, nit_emisor, fecha_emision, fecha_recepcion, total, iva,
                        estado, sede_id, asignada_por, asignada_en, sellada_por, sellada_en, archivo_pdf, recibido_por)
  values (v_cufe, v_ped.marca_id, 'cuenta_cobro', 'insumos', v_num, v_emisor, v_nit, p_fecha_recibido, now(), p_total, 0,
          'sellada', v_ped.sede_id, auth.uid(), now(), auth.uid(), now(), p_foto, nullif(btrim(coalesce(p_usuario, '')), ''));
  insert into cuenta_cobro_linea (factura_cufe, orden, codigo, articulo, cantidad, precio_unitario, subtotal)
  select v_cufe, x.n, nullif(btrim(x.l->>'codigo'), ''), btrim(x.l->>'articulo'), (x.l->>'cantidad')::numeric, (x.l->>'precio_unitario')::numeric,
         round((x.l->>'cantidad')::numeric * (x.l->>'precio_unitario')::numeric)
    from jsonb_array_elements(p_lineas) with ordinality as x(l, n);
  -- el amarre de siempre (Fecha Recibido, centro de costo, NIT del proveedor)
  perform pedido_factura_amarrar(p_pedido_id, v_cufe, p_usuario, false, null, p_fecha_recibido, p_centro_costo);
  return v_cufe;
end
$$;
revoke all on function cuenta_cobro_amarrar(bigint, text, date, numeric, text, jsonb, text, text) from public, anon;
grant execute on function cuenta_cobro_amarrar(bigint, text, date, numeric, text, jsonb, text, text) to authenticated;
