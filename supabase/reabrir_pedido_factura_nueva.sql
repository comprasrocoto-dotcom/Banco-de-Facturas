-- ============================================================
--  reabrir_pedido_factura_nueva.sql  -  PEDIDO "FACTURADO" AL QUE SE LE AMARRA OTRA FACTURA (aun no en el ERP)  -  06/10/2026
--  Caso real PED-0256: se facturo en el ERP con la factura equivocada (FCRC3906 / 1FEV1374564), se corrigio a mano y se le
--  amarro la correcta (1FEV1374563), pero el agente no lo tomaba: el pedido seguia "facturado" y su documento COMPLETADO
--  (los dos le dicen al agente "ya esta hecho"). Ahora, si a un pedido FACTURADO se le amarra una factura DISTINTA que todavia
--  NO tiene N° de ingreso del ERP:
--    - el pedido vuelve a "pendiente" (trigger BEFORE, junto a la fecha de enlace);
--    - su documento COMPLETADO (de OTRA factura) vuelve a PENDIENTE (trigger AFTER, junto al de DESCARTADO).
--  Si la factura nueva ya existe en el ERP, el agente lo ve por su Su Doc y no crea otra (YA_EXISTE). Un amarre normal
--  (pedido pendiente) no cambia en nada.
-- ============================================================
create or replace function trg_pedido_factura_amarrada() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.factura_cufe is distinct from old.factura_cufe then
    new.factura_amarrada_en := case when new.factura_cufe is null then null else now() end;
    if new.factura_cufe is null then new.fecha_recibido := null; end if;
    -- (06/10/2026) facturado + factura NUEVA que el ERP aun no tiene -> vuelve a pendiente para que el agente la ingrese
    if new.factura_cufe is not null and old.estado = 'facturado' and new.estado = 'facturado'
       and exists (select 1 from facturas f where f.cufe = new.factura_cufe and coalesce(btrim(f.num_ingreso), '') = '') then
      new.estado := 'pendiente';
    end if;
  end if;
  return new;
end;
$$;

create or replace function trg_pedido_reencolar_descartado() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.factura_cufe is not null and new.factura_cufe is distinct from old.factura_cufe then
    update ingreso_documento
       set estado = 'PENDIENTE', etapa = 'factura nueva amarrada: vuelve a la cola',
           error = null, error_etapa = null, actualizado_en = now(), terminado_en = null
     where pedido_id = new.id
       and (estado = 'DESCARTADO'
            -- (06/10/2026) COMPLETADO con OTRA factura y la nueva aun no esta en el ERP
            or (estado = 'COMPLETADO' and factura_cufe is distinct from new.factura_cufe
                and exists (select 1 from facturas f where f.cufe = new.factura_cufe and coalesce(btrim(f.num_ingreso), '') = '')));
  end if;
  return null;
end;
$$;
