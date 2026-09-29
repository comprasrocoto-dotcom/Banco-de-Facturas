-- ============================================================
--  amarre_pedido_factura.sql  -  BLOQUEO DURO por NIT al amarrar pedido <-> factura (28/09/2026)   ADITIVO
--  Hasta ahora, amarrar una factura a un pedido de OTRO proveedor solo mostraba una advertencia que se podia aceptar
--  igual (confirmarSiOtroProveedor en la web), y el amarre automatico por SQL (supabase/amarre_automatico.sql) ni
--  siquiera miraba el NIT: comparaba solo el numero de documento. El agente ya se negaba a facturar en ese caso
--  (facturaDelProveedorDelPedido en lib/proveedor-pedido.js) pero el amarre incorrecto quedaba guardado en
--  pedidos.factura_cufe (casos reales: PED-0149, PED-0167, PED-0193).
--
--  Ahora: si el NIT del proveedor del pedido y el NIT emisor de la factura son DISTINTOS (y los DOS se conocen),
--  el amarre NO se guarda -- sea por la funcion de abajo o por cualquier UPDATE directo a pedidos.factura_cufe
--  (trigger a nivel de tabla: protege tambien al amarre_automatico.sql viejo si se vuelve a correr) -- salvo que
--  un ADMIN lo fuerce con un motivo, usando pedido_factura_amarrar(), quedando registrado en amarre_forzado.
--  Tolera el digito de verificacion del NIT (mismo criterio que nitIgual en lib/proveedor-pedido.js).
--  Si algun NIT falta, no se puede comparar por NIT: se deja pasar (el aviso por NOMBRE de la web sigue igual
--  que antes, con confirmarSiOtroProveedor, que se puede aceptar).
--  No toca facturas, pedidos.* existentes, ni ningun otro amarre (proveedor_alias, nota_credito_factura, etc.)
-- ============================================================

-- bitacora de amarres forzados por un admin (queda quien, cual pedido/factura y por que)
create table if not exists amarre_forzado (
  id           bigint generated always as identity primary key,
  pedido_id    bigint not null references pedidos(id),
  factura_cufe text not null references facturas(cufe),
  motivo       text not null,
  usuario      text,
  creado_en    timestamptz not null default now()
);
alter table amarre_forzado enable row level security;
drop policy if exists amarre_forzado_leer on amarre_forzado;
create policy amarre_forzado_leer on amarre_forzado for select to authenticated using (mi_rol() = any (array['admin','pagos']));
revoke all on amarre_forzado from anon, authenticated;
grant select on amarre_forzado to authenticated;

-- ¿los dos NIT (ya limpios, solo digitos) son el MISMO proveedor? tolera el digito de verificacion (900456012-1 = 900456012).
-- null si alguno viene vacio: "no se puede comparar" (no es lo mismo que "son distintos").
create or replace function nit_mismo_proveedor(a text, b text) returns boolean
language sql immutable as $$
  select case when da = '' or db = '' then null
              else (da = db or left(da, length(da) - 1) = db or left(db, length(db) - 1) = da)
         end
  from (select regexp_replace(coalesce(a, ''), '\D', '', 'g') da, regexp_replace(coalesce(b, ''), '\D', '', 'g') db) s
$$;

-- Antes de escribir pedidos.factura_cufe (por cualquier via): si los NIT se conocen y son DISTINTOS, se omite esa
-- fila (return null = esa fila no se actualiza, pero no rompe el resto de un UPDATE de varias filas como
-- amarre_automatico.sql) -- salvo que pedido_factura_amarrar() ya haya dejado el motivo forzado para esta transaccion.
create or replace function trg_bloquear_amarre_otro_proveedor() returns trigger
language plpgsql as $$
declare v_nit_factura text; v_motivo text;
begin
  if new.factura_cufe is not null and new.factura_cufe is distinct from old.factura_cufe then
    select nit_emisor into v_nit_factura from facturas where cufe = new.factura_cufe;
    if nit_mismo_proveedor(new.nit_proveedor, v_nit_factura) = false then
      v_motivo := nullif(current_setting('bf.amarre_motivo', true), '');
      if v_motivo is null then
        return null;   -- bloqueado: esta fila no se amarra
      end if;
      insert into amarre_forzado (pedido_id, factura_cufe, motivo, usuario)
      values (new.id, new.factura_cufe, v_motivo, nullif(current_setting('bf.amarre_usuario', true), ''));
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists bloquear_amarre_otro_proveedor on pedidos;
create trigger bloquear_amarre_otro_proveedor before update on pedidos
  for each row execute function trg_bloquear_amarre_otro_proveedor();

-- Amarra un pedido con una factura (usar esto desde la web en vez de UPDATE directo a factura_cufe).
-- p_forzar: solo un admin, con un motivo obligatorio (queda en amarre_forzado). Sin forzar, si el NIT no
-- coincide, el trigger de arriba omite el UPDATE y esta funcion lo convierte en un mensaje claro.
--
-- FIX (29/09/2026): la primera version exigia admin/pagos, pero la politica ped_amarrar YA dejaba a una
-- SEDE amarrar SU PROPIO pedido (sede_id = mi_sede() o marca_id = mi_marca()) desde antes de este bloqueo
-- por NIT; las sedes quedaron sin poder amarrar ningun pedido ("Solo admin o pagos pueden amarrar.",
-- reportado por el usuario con captura). Se agrega ese mismo permiso; forzar sigue siendo solo admin.
create or replace function pedido_factura_amarrar(p_pedido_id bigint, p_cufe text, p_usuario text default null, p_forzar boolean default false, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_filas integer; v_pedido pedidos%rowtype;
begin
  select * into v_pedido from pedidos where id = p_pedido_id;
  if not found then raise exception 'Ese pedido no existe.' using errcode = '22023'; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and mi_rol() not in ('admin', 'pagos')
     and not (mi_rol() = 'sede' and (v_pedido.sede_id = mi_sede() or v_pedido.marca_id = mi_marca()))
  then
    raise exception 'Sin permiso para amarrar este pedido.' using errcode = '42501';
  end if;
  if not exists (select 1 from facturas where cufe = p_cufe) then raise exception 'Esa factura no existe.' using errcode = '22023'; end if;
  if p_forzar then
    if mi_rol() <> 'admin' then raise exception 'Solo un administrador puede forzar un amarre con otro proveedor.' using errcode = '42501'; end if;
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribe el motivo para forzar el amarre.' using errcode = '22023'; end if;
    perform set_config('bf.amarre_motivo', btrim(p_motivo), true);
    perform set_config('bf.amarre_usuario', coalesce(nullif(btrim(p_usuario), ''), 'admin'), true);
  end if;
  update pedidos set factura_cufe = p_cufe where id = p_pedido_id;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'La factura es de otro proveedor (NIT distinto al del pedido). Solo un administrador puede forzarlo con un motivo.' using errcode = '22023';
  end if;
end
$$;
revoke all on function pedido_factura_amarrar(bigint, text, text, boolean, text) from public;
grant execute on function pedido_factura_amarrar(bigint, text, text, boolean, text) to authenticated;
