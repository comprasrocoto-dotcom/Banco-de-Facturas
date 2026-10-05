-- Un documento "sacado de la cola" (DESCARTADO, boton Quitar / Limpiar ventana) vuelve a la cola sola si despues
-- le amarran una factura al pedido (factura_cufe pasa a un valor nuevo no nulo). Soltar la factura o editar otra
-- cosa del pedido NO lo reactiva. (05/10/2026)
create or replace function trg_pedido_reencolar_descartado() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.factura_cufe is not null and new.factura_cufe is distinct from old.factura_cufe then
    update ingreso_documento
       set estado = 'PENDIENTE', etapa = 'factura nueva amarrada: vuelve a la cola',
           error = null, error_etapa = null, actualizado_en = now(), terminado_en = null
     where pedido_id = new.id and estado = 'DESCARTADO';
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_pedido_reencolar_descartado_t on pedidos;
create trigger trg_pedido_reencolar_descartado_t after update of factura_cufe on pedidos
  for each row execute function trg_pedido_reencolar_descartado();
