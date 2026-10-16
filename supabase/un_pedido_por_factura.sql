-- ============================================================
--  UNA FACTURA = UN PEDIDO PARA LAS SEDES (16/10/2026, pedido del usuario)
-- ============================================================
-- Las sedes estaban amarrando DOS pedidos a la misma factura (10 facturas al 16/10). Desde ahora, si quien amarra es una SEDE y
-- la factura ya esta amarrada a OTRO pedido (no anulado), el amarre no se guarda, sea por pedido_factura_amarrar o por un UPDATE
-- directo. Admin, pagos y el agente (service_role) siguen pudiendo (casos reales: un pedido partido en dos). La web ademas avisa
-- antes (js/un-pedido-factura.js). Solo aditivo: una funcion y un trigger nuevos; no toca datos ni los amarres que ya existen.
create or replace function trg_un_pedido_por_factura() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_otro text;
begin
  if new.factura_cufe is null then return new; end if;
  if tg_op = 'UPDATE' and new.factura_cufe is not distinct from old.factura_cufe then return new; end if;
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' or coalesce(mi_rol(), '') <> 'sede' then return new; end if;
  select coalesce(numero, pedido_erp, id::text) into v_otro from pedidos
   where factura_cufe = new.factura_cufe and id <> new.id and coalesce(estado::text, '') <> 'anulado' limit 1;
  if v_otro is not null then
    raise exception 'Esa factura ya está amarrada al pedido %. Cada factura va con un solo pedido: si es un error, pide a administración que lo desamarre.', v_otro using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists un_pedido_por_factura on pedidos;
create trigger un_pedido_por_factura before insert or update of factura_cufe on pedidos
  for each row execute function trg_un_pedido_por_factura();
