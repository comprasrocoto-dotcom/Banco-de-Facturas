-- ============================================================
--  centro_costo.sql  -  CENTRO DE COSTO (SERIE DEL ERP) AL AMARRAR  -  09/10/2026   ADITIVO
--  En el ERP de 123 Wok (San Agustin), Casa de Nadie y Sin Par la factura de compra se crea con la SERIE del centro de
--  costo: FC.COCINA, FC.BAR, FC.ASEO, FC.EMPAQUES... (una sola por factura). El usuario decidio (09/10/2026):
--   - al AMARRAR la factura con su pedido, la persona ELIGE el centro de costo (obligatorio solo para esas marcas);
--   - el agente crea la factura en el ERP con ESA serie (nunca una por defecto) y el N° de ingreso queda con ella
--     (FC.BAR1890); DETALLE = BAR / COCINA... segun la serie.
--  centro_costo_serie: marca + centro -> la serie EXACTA del ERP (sacada del informe real de Facturas de compra; en Casa
--  de Nadie el aseo es "FC. ASEO", con espacio). Las marcas que NO estan aqui (Rocoto, Arrebatao) siguen igual que hoy.
--  pedidos.centro_costo guarda la serie elegida; se limpia sola al soltar la factura (como la Fecha Recibido).
-- ============================================================
create table if not exists centro_costo_serie (
  marca_id   integer not null references marcas(id),
  centro     text not null,            -- COCINA, BAR, ... (lo que se ve como DETALLE)
  serie_erp  text not null,            -- la serie exacta del ERP de esa marca
  orden      integer not null default 0,
  activo     boolean not null default true,
  primary key (marca_id, serie_erp)
);
alter table centro_costo_serie enable row level security;
drop policy if exists ccs_leer on centro_costo_serie;
create policy ccs_leer on centro_costo_serie for select to authenticated using (true);
drop policy if exists ccs_escribir on centro_costo_serie;
create policy ccs_escribir on centro_costo_serie for all to authenticated using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
revoke all on centro_costo_serie from anon;
grant select, insert, update, delete on centro_costo_serie to authenticated;

insert into centro_costo_serie (marca_id, centro, serie_erp, orden)
select m.id, v.centro, v.serie, v.orden
from marcas m
join (values
  ('123 wok', 'COCINA', 'FC.COCINA', 1), ('123 wok', 'BAR', 'FC.BAR', 2), ('123 wok', 'ELEMENTOS DE ASEO Y CAFETERIA', 'FC.ASEO', 3),
  ('123 wok', 'EMPAQUES', 'FC.EMPAQUES', 4), ('123 wok', 'UTILES Y PAPELERIA', 'FC.UTILESYPAPELERIA', 5),
  ('Casa de Nadie', 'COCINA', 'FC.COCINA', 1), ('Casa de Nadie', 'BAR', 'FC.BAR', 2), ('Casa de Nadie', 'ELEMENTOS DE ASEO Y CAFETERIA', 'FC. ASEO', 3),
  ('Casa de Nadie', 'EMPAQUES', 'FC.EMPAQUES', 4),
  ('Sin Par', 'COCINA', 'FC.COCINA', 1), ('Sin Par', 'BAR', 'FC.BAR', 2),
  -- (10/10/2026) Rocoto y Arrebatao: centro de costo obligatorio al amarrar (la serie real del ERP es FCRC/FCAR,
  -- pero el centro se elige y se guarda en pedidos.centro_costo; el organizador lo lee de ahi)
  ('Rocoto', 'COCINA', 'FCRC.COCINA', 1), ('Rocoto', 'BAR', 'FCRC.BAR', 2), ('Rocoto', 'ASEO', 'FCRC.ASEO', 3),
  ('Rocoto', 'EMPAQUE', 'FCRC.EMPAQUE', 4), ('Rocoto', 'UTENSILIOS', 'FCRC.UTENSILIOS', 5),
  ('Arrebatao', 'COCINA', 'FCAR.COCINA', 1), ('Arrebatao', 'BAR', 'FCAR.BAR', 2), ('Arrebatao', 'ASEO', 'FCAR.ASEO', 3),
  ('Arrebatao', 'EMPAQUE', 'FCAR.EMPAQUE', 4), ('Arrebatao', 'UTENSILIOS', 'FCAR.UTENSILIOS', 5)
) as v(marca, centro, serie, orden) on m.nombre = v.marca
on conflict (marca_id, serie_erp) do nothing;

alter table pedidos add column if not exists centro_costo text;

-- al soltar la factura se limpian juntas la fecha de enlace, la Fecha Recibido y el centro de costo
-- (copia exacta de la version viva de reabrir_pedido_factura_nueva.sql + la linea del centro de costo)
create or replace function trg_pedido_factura_amarrada() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.factura_cufe is distinct from old.factura_cufe then
    new.factura_amarrada_en := case when new.factura_cufe is null then null else now() end;
    if new.factura_cufe is null then new.fecha_recibido := null; new.centro_costo := null; end if;
    if new.factura_cufe is not null and old.estado = 'facturado' and new.estado = 'facturado'
       and exists (select 1 from facturas f where f.cufe = new.factura_cufe and coalesce(btrim(f.num_ingreso), '') = '') then
      new.estado := 'pendiente';
    end if;
  end if;
  return new;
end;
$$;

drop function if exists pedido_factura_amarrar(bigint, text, text, boolean, text, date);
create or replace function pedido_factura_amarrar(p_pedido_id bigint, p_cufe text, p_usuario text default null, p_forzar boolean default false, p_motivo text default null, p_fecha_recibido date default null, p_centro_costo text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_filas integer; v_pedido pedidos%rowtype; v_hoy date := (now() at time zone 'America/Bogota')::date; v_centro text := null;
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
  -- (09/10/2026) Centro de costo: obligatorio solo en las marcas que lo tienen configurado, y tiene que ser una serie activa de ESA marca
  if exists (select 1 from centro_costo_serie where marca_id = v_pedido.marca_id and activo) then
    if coalesce(btrim(p_centro_costo), '') = '' then raise exception 'Elige el centro de costo de la factura (Cocina, Bar...).' using errcode = '22023'; end if;
    select serie_erp into v_centro from centro_costo_serie where marca_id = v_pedido.marca_id and activo and serie_erp = btrim(p_centro_costo);
    if v_centro is null then raise exception 'El centro de costo "%" no existe para esta marca.', btrim(p_centro_costo) using errcode = '22023'; end if;
  end if;
  if p_forzar then
    if mi_rol() <> 'admin' then raise exception 'Solo un administrador puede forzar un amarre con otro proveedor.' using errcode = '42501'; end if;
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribe el motivo para forzar el amarre.' using errcode = '22023'; end if;
    perform set_config('bf.amarre_motivo', btrim(p_motivo), true);
    perform set_config('bf.amarre_usuario', coalesce(nullif(btrim(p_usuario), ''), 'admin'), true);
  end if;
  update pedidos set factura_cufe = p_cufe, fecha_recibido = p_fecha_recibido, centro_costo = v_centro where id = p_pedido_id;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'La factura es de otro proveedor (NIT distinto al del pedido). Solo un administrador puede forzarlo con un motivo.' using errcode = '22023';
  end if;
end
$$;
revoke all on function pedido_factura_amarrar(bigint, text, text, boolean, text, date, text) from public;
grant execute on function pedido_factura_amarrar(bigint, text, text, boolean, text, date, text) to authenticated;
