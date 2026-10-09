-- ============================================================
--  organizador_reglas_y_centros.sql  -  09/10/2026   ADITIVO (no borra nada, no DROP de tablas, sin borrados masivos)
--  Pedido del usuario ("PROMPT MAESTRO" 09/10/2026):
--   1) Centros de costo: en San Agustin (= 123 wok), Casa de Nadie y Sin Par se usan LOS CODIGOS QUE EL USUARIO PIDIO:
--      FC.COCINA, FC.BAR, FC. ASEO, FC. UTILES Y PAPELERIA, FC. EMPAQUES. (Se le mostro que en su informe real aparecen
--      FC.ASEO / FC.EMPAQUES / FC.UTILESYPAPELERIA y confirmo los suyos.) El agente busca la serie EXACTA en el ERP: si no
--      existe, deja la factura PENDIENTE DE REVISION con el motivo; nunca la cambia por una parecida.
--      Ningun pedido tenia centro de costo guardado al cambiar los codigos (verificado).
--   2) Factura con productos de VARIOS centros: al amarrar se puede marcar 'VARIOS'; el agente NO la ingresa (pendiente de
--      revision), porque el ERP acepta una sola serie por factura.
--   3) Reglas del Organizador Hiopos auditables: activa/inactiva, "NO es cuenta de cobro", nota de la evidencia, e
--      historial de cada cambio (quien, cuando, antes y despues).
--   4) Historial de ejecuciones del Organizador (huella SHA-256 del archivo): avisa si el mismo archivo ya se organizo.
-- ============================================================

-- 1) codigos pedidos por el usuario
update centro_costo_serie c set serie_erp = v.nueva
from marcas m, (values ('FC.ASEO', 'FC. ASEO'), ('FC.EMPAQUES', 'FC. EMPAQUES'), ('FC.UTILESYPAPELERIA', 'FC. UTILES Y PAPELERIA')) as v(vieja, nueva)
where c.marca_id = m.id and m.nombre in ('123 wok', 'Casa de Nadie', 'Sin Par') and c.serie_erp = v.vieja
  and not exists (select 1 from centro_costo_serie x where x.marca_id = c.marca_id and x.serie_erp = v.nueva);

-- 2) VARIOS (mixta) aceptado al amarrar en las marcas con centros de costo
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
  if p_fecha_recibido is null then raise exception 'Escribe la Fecha Recibido de la factura.' using errcode = '22023'; end if;
  if v_pedido.fecha is not null and p_fecha_recibido < v_pedido.fecha then
    raise exception 'La Fecha Recibido (%) no puede ser anterior a la fecha del pedido (%).', to_char(p_fecha_recibido, 'DD/MM/YYYY'), to_char(v_pedido.fecha, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_fecha_recibido > v_hoy then
    raise exception 'La Fecha Recibido (%) no puede ser futura.', to_char(p_fecha_recibido, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- centro de costo: obligatorio solo en las marcas que lo tienen configurado; una serie activa de ESA marca, o VARIOS (mixta)
  if exists (select 1 from centro_costo_serie where marca_id = v_pedido.marca_id and activo) then
    if coalesce(btrim(p_centro_costo), '') = '' then raise exception 'Elige el centro de costo de la factura (Cocina, Bar...).' using errcode = '22023'; end if;
    if btrim(p_centro_costo) = 'VARIOS' then v_centro := 'VARIOS';
    else
      select serie_erp into v_centro from centro_costo_serie where marca_id = v_pedido.marca_id and activo and serie_erp = btrim(p_centro_costo);
      if v_centro is null then raise exception 'El centro de costo "%" no existe para esta marca.', btrim(p_centro_costo) using errcode = '22023'; end if;
    end if;
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

-- 3) reglas auditables del Organizador
alter table hiopos_contacto_regla add column if not exists activo boolean not null default true;
alter table hiopos_contacto_regla add column if not exists no_cuenta_cobro boolean not null default false;
alter table hiopos_contacto_regla add column if not exists nota text;
alter table hiopos_contacto_regla drop constraint if exists hcr_cobro_coherente;
alter table hiopos_contacto_regla add constraint hcr_cobro_coherente check (not (cuenta_cobro and no_cuenta_cobro));

create table if not exists hiopos_regla_historial (
  id bigserial primary key,
  contacto_norm text not null,
  accion text not null,              -- INSERT / UPDATE / DELETE
  antes jsonb,
  despues jsonb,
  usuario text,
  en timestamptz not null default now()
);
alter table hiopos_regla_historial enable row level security;
drop policy if exists hrh_leer on hiopos_regla_historial;
create policy hrh_leer on hiopos_regla_historial for select to authenticated using (mi_rol() in ('admin', 'pagos'));
revoke all on hiopos_regla_historial from anon;
grant select on hiopos_regla_historial to authenticated;   -- solo el disparador escribe

create or replace function trg_hiopos_regla_historial() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into hiopos_regla_historial (contacto_norm, accion, antes, despues, usuario)
  values (coalesce(new.contacto_norm, old.contacto_norm), tg_op,
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end,
          case when tg_op = 'DELETE' then null else new.actualizado_por end);
  return coalesce(new, old);
end;
$$;
drop trigger if exists hiopos_regla_historial_t on hiopos_contacto_regla;
create trigger hiopos_regla_historial_t after insert or update or delete on hiopos_contacto_regla
  for each row execute function trg_hiopos_regla_historial();

-- 4) historial de ejecuciones del Organizador
create table if not exists hiopos_organizador_ejecucion (
  id bigserial primary key,
  huella text not null,              -- SHA-256 del archivo cargado
  archivo text,
  documentos integer,
  neto numeric,
  resumen jsonb,
  usuario text,
  creado_en timestamptz not null default now()
);
create index if not exists hoe_huella on hiopos_organizador_ejecucion (huella);
alter table hiopos_organizador_ejecucion enable row level security;
drop policy if exists hoe_leer on hiopos_organizador_ejecucion;
create policy hoe_leer on hiopos_organizador_ejecucion for select to authenticated using (mi_rol() in ('admin', 'pagos'));
drop policy if exists hoe_agregar on hiopos_organizador_ejecucion;
create policy hoe_agregar on hiopos_organizador_ejecucion for insert to authenticated with check (mi_rol() in ('admin', 'pagos'));
revoke all on hiopos_organizador_ejecucion from anon;
grant select, insert on hiopos_organizador_ejecucion to authenticated;
grant usage on sequence hiopos_organizador_ejecucion_id_seq to authenticated;
