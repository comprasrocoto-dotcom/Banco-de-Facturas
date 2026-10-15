-- ============================================================
--  QUE DOCUMENTO ENTREGA CADA PROVEEDOR (14/10/2026, pedido del usuario)
-- ============================================================
-- En el pedido: si el proveedor da FACTURA ELECTRONICA solo se ofrecen «📸 Foto de la factura» y «🔗 Amarrar a factura»;
-- si da CUENTA DE COBRO, solo «📷 Cuenta de cobro». Sin dato (proveedor nuevo), se ofrecen las tres como antes.
--   documento: 'factura' | 'cuenta_cobro' | null (sin definir)
-- Se llena con el historial del banco y luego SOLO se completa (nunca se pisa lo que eligio el administrador en Admin):
-- el primer documento de un proveedor sin dato que llega al banco lo define.
-- Solo aditivo: columna nueva, funcion y trigger nuevos (el trigger nunca frena la carga de una factura).
alter table proveedores add column if not exists documento text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'proveedores_documento_valido') then
    alter table proveedores add constraint proveedores_documento_valido check (documento is null or documento in ('factura', 'cuenta_cobro'));
  end if;
end $$;

-- historial: con facturas electronicas -> 'factura'; solo con cuentas de cobro -> 'cuenta_cobro'
update proveedores pr set documento = 'factura'
 where pr.documento is null and coalesce(pr.nit, '') <> ''
   and exists (select 1 from facturas f where f.tipo = 'factura' and nit_mismo_proveedor(pr.nit, f.nit_emisor) is true);
update proveedores pr set documento = 'cuenta_cobro'
 where pr.documento is null and coalesce(pr.nit, '') <> ''
   and exists (select 1 from facturas f where f.tipo = 'cuenta_cobro' and nit_mismo_proveedor(pr.nit, f.nit_emisor) is true);

create or replace function trg_proveedor_documento_aprender()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo in ('factura', 'cuenta_cobro') and coalesce(new.nit_emisor, '') <> '' then
    update proveedores set documento = new.tipo
     where documento is null and coalesce(nit, '') <> '' and nit_mismo_proveedor(nit, new.nit_emisor) is true;
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists trg_proveedor_documento_aprender_t on facturas;
create trigger trg_proveedor_documento_aprender_t after insert on facturas
  for each row execute function trg_proveedor_documento_aprender();
