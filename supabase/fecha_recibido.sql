-- ============================================================
--  fecha_recibido.sql  -  FECHA RECIBIDO DE LA FACTURA (la escribe la persona al amarrar)  -  06/10/2026   ADITIVO
--  Pedido del usuario: para la trazabilidad de la recepcion de la mercancia, al ENLAZAR una factura con su pedido la
--  persona escribe la FECHA RECIBIDO (muchas veces no es la del pedido ni la del dia del enlace).
--   - pedidos.fecha_recibido (date): obligatoria al amarrar; IGUAL O POSTERIOR a la fecha del pedido y no futura
--     (dia de Colombia). La base lo exige (no solo la web).
--   - el agente la pone en el ERP como Fecha Doc, Fecha Su Doc y Fecha Contabilizacion (antes: la fecha del enlace).
--   - al soltar la factura (desamarrar o borrarla) se limpia sola, como la fecha de enlace.
--  Los pedidos ya amarrados quedan con fecha_recibido vacia (el agente sigue usando su fecha de enlace).
-- ============================================================
alter table pedidos add column if not exists fecha_recibido date;
alter table pedidos drop constraint if exists pedidos_fecha_recibido_valida;
alter table pedidos add constraint pedidos_fecha_recibido_valida check (fecha_recibido is null or fecha is null or fecha_recibido >= fecha);

-- la fecha de enlace y la de recibido se limpian juntas al soltar la factura
create or replace function trg_pedido_factura_amarrada() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.factura_cufe is distinct from old.factura_cufe then
    new.factura_amarrada_en := case when new.factura_cufe is null then null else now() end;
    if new.factura_cufe is null then new.fecha_recibido := null; end if;
  end if;
  return new;
end;
$$;

drop function if exists pedido_factura_amarrar(bigint, text, text, boolean, text);
create or replace function pedido_factura_amarrar(p_pedido_id bigint, p_cufe text, p_usuario text default null, p_forzar boolean default false, p_motivo text default null, p_fecha_recibido date default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_filas integer; v_pedido pedidos%rowtype; v_hoy date := (now() at time zone 'America/Bogota')::date;
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
  -- (06/10/2026) Fecha Recibido: obligatoria, desde la fecha del pedido y no futura
  if p_fecha_recibido is null then raise exception 'Escribe la Fecha Recibido de la factura.' using errcode = '22023'; end if;
  if v_pedido.fecha is not null and p_fecha_recibido < v_pedido.fecha then
    raise exception 'La Fecha Recibido (%) no puede ser anterior a la fecha del pedido (%).', to_char(p_fecha_recibido, 'DD/MM/YYYY'), to_char(v_pedido.fecha, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_fecha_recibido > v_hoy then
    raise exception 'La Fecha Recibido (%) no puede ser futura.', to_char(p_fecha_recibido, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_forzar then
    if mi_rol() <> 'admin' then raise exception 'Solo un administrador puede forzar un amarre con otro proveedor.' using errcode = '42501'; end if;
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribe el motivo para forzar el amarre.' using errcode = '22023'; end if;
    perform set_config('bf.amarre_motivo', btrim(p_motivo), true);
    perform set_config('bf.amarre_usuario', coalesce(nullif(btrim(p_usuario), ''), 'admin'), true);
  end if;
  update pedidos set factura_cufe = p_cufe, fecha_recibido = p_fecha_recibido where id = p_pedido_id;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'La factura es de otro proveedor (NIT distinto al del pedido). Solo un administrador puede forzarlo con un motivo.' using errcode = '22023';
  end if;
end
$$;
revoke all on function pedido_factura_amarrar(bigint, text, text, boolean, text, date) from public;
grant execute on function pedido_factura_amarrar(bigint, text, text, boolean, text, date) to authenticated;
