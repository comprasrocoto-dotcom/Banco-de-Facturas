-- ============================================================
--  FOTO DE LA FACTURA EN EL PEDIDO -> se busca sola en el banco y se amarra (14/10/2026, pedido del usuario)
-- ============================================================
-- Las facturas se siguen subiendo al banco como siempre. La sede, desde el pedido, toma una foto de la factura (el N° sale
-- del codigo QR o lo escribe) y el sistema busca ESA factura en el banco (mismo proveedor por NIT + mismo numero, o el CUFE
-- exacto del QR) y la amarra a ESE pedido. Si todavia no esta en el banco queda ESPERANDO y se amarra sola cuando llegue
-- (trigger en facturas). Si hay dudas (varias coinciden, ya esta en otro pedido, otro proveedor) queda NOVEDAD y no se toca.
-- Solo aditivo: tabla nueva, funciones nuevas y un trigger nuevo que nunca frena la carga de una factura.
-- La comparacion de numeros es la misma de banco_web/js/factura-foto.js (coincide): si cambia una, cambiar la otra.

create table if not exists factura_foto (
  id bigserial primary key,
  pedido_id bigint not null references pedidos(id) on delete cascade,
  numero text not null,
  cufe_qr text,
  foto text not null,
  fecha_recibido date not null,
  centro_costo text,
  recibido_por text,
  estado text not null default 'ESPERANDO' check (estado in ('ESPERANDO', 'AMARRADA', 'NOVEDAD', 'CANCELADA')),
  motivo text,
  factura_cufe text references facturas(cufe) on delete set null,
  intentos integer not null default 0,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  ultimo_intento_en timestamptz,
  amarrada_en timestamptz
);
create index if not exists factura_foto_pendientes on factura_foto (estado) where estado in ('ESPERANDO', 'NOVEDAD');
create unique index if not exists factura_foto_una_viva on factura_foto (pedido_id) where estado in ('ESPERANDO', 'NOVEDAD');

alter table factura_foto enable row level security;
-- se ve si se ve el pedido (las politicas de pedidos deciden: sede = sus pedidos, admin/pagos todos, analistas sus sedes)
drop policy if exists factura_foto_ver on factura_foto;
create policy factura_foto_ver on factura_foto for select to authenticated
  using (exists (select 1 from pedidos p where p.id = factura_foto.pedido_id));
-- nadie escribe directo: solo por factura_foto_registrar (security definer)

-- ¿el numero escrito es el de esta factura? (igual que FacturaFoto.coincide)
create or replace function factura_numero_coincide(p_escrito text, p_prefijo text, p_folio text, p_documento text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  e text := upper(regexp_replace(coalesce(p_escrito, ''), '[^A-Za-z0-9]', '', 'g'));
  pre text := upper(regexp_replace(coalesce(p_prefijo, ''), '[^A-Za-z0-9]', '', 'g'));
  fol text := upper(regexp_replace(coalesce(p_folio, ''), '[^A-Za-z0-9]', '', 'g'));
  doc text;
  folN text; delante text; atras text; cola text; cabeza text; i integer;
begin
  if e = '' then return false; end if;
  doc := upper(regexp_replace(coalesce(nullif(p_documento, ''), pre || fol), '[^A-Za-z0-9]', '', 'g'));
  if e = doc or (fol <> '' and e = pre || fol) then return true; end if;
  if fol = '' or fol !~ '^[0-9]+$' then return false; end if;
  folN := regexp_replace(fol, '^0+(?=[0-9])', '');
  cola := substring(e from '([0-9]+)$');
  if cola is null then return false; end if;
  cabeza := left(e, length(e) - length(cola));
  for i in 0 .. length(cola) - 1 loop
    delante := cabeza || left(cola, i);
    atras := substr(cola, i + 1);
    if regexp_replace(atras, '^0+(?=[0-9])', '') = folN then
      if regexp_replace(delante, '0+$', '') = '' or regexp_replace(delante, '0+$', '') = regexp_replace(pre, '0+$', '') then
        return true;
      end if;
    end if;
  end loop;
  return false;
end $$;

-- intenta amarrar UNA foto. Interna (sin permisos propios): la llaman factura_foto_registrar, factura_foto_reintentar y el trigger.
-- -> estado final de la foto
create or replace function factura_foto_intentar(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  x factura_foto%rowtype; p pedidos%rowtype; v_nit text; v_cufe text; v_n integer; v_otro text; v_filas integer;
begin
  select * into x from factura_foto where id = p_id for update;
  if not found or x.estado not in ('ESPERANDO', 'NOVEDAD') then return coalesce(x.estado, 'NO_EXISTE'); end if;
  select * into p from pedidos where id = x.pedido_id;
  update factura_foto set intentos = intentos + 1, ultimo_intento_en = now() where id = p_id;
  if p.estado = 'anulado' then
    update factura_foto set estado = 'CANCELADA', motivo = 'el pedido está anulado' where id = p_id; return 'CANCELADA';
  end if;
  select coalesce(nullif(btrim(p.nit_proveedor), ''), nullif(btrim(pr.nit), '')) into v_nit from proveedores pr where pr.id = p.proveedor_id;
  v_nit := coalesce(v_nit, nullif(btrim(p.nit_proveedor), ''));

  -- 1) CUFE exacto del QR; 2) mismo proveedor (NIT) + mismo numero
  select count(*), min(f.cufe) into v_n, v_cufe from facturas f
   where f.tipo = 'factura' and f.estado <> 'rechazada'
     and ((x.cufe_qr is not null and f.cufe = x.cufe_qr)
          or (x.cufe_qr is null and v_nit is not null and nit_mismo_proveedor(v_nit, f.nit_emisor) is true
              and factura_numero_coincide(x.numero, f.prefijo, f.folio, f.documento)));
  if v_n = 0 and x.cufe_qr is not null and v_nit is not null then   -- QR leido pero la factura aun no esta: probar por numero
    select count(*), min(f.cufe) into v_n, v_cufe from facturas f
     where f.tipo = 'factura' and f.estado <> 'rechazada' and nit_mismo_proveedor(v_nit, f.nit_emisor) is true
       and factura_numero_coincide(x.numero, f.prefijo, f.folio, f.documento);
  end if;

  if v_n = 0 then
    if v_nit is null and x.cufe_qr is null then
      update factura_foto set estado = 'NOVEDAD', motivo = 'el pedido no tiene el NIT del proveedor: amárrala a mano' where id = p_id; return 'NOVEDAD';
    end if;
    update factura_foto set estado = 'ESPERANDO', motivo = null where id = p_id; return 'ESPERANDO';
  end if;
  if v_n > 1 then
    update factura_foto set estado = 'NOVEDAD', motivo = v_n || ' facturas del proveedor tienen ese número: amárrala a mano' where id = p_id; return 'NOVEDAD';
  end if;
  if v_nit is not null and nit_mismo_proveedor(v_nit, (select nit_emisor from facturas where cufe = v_cufe)) is false then
    update factura_foto set estado = 'NOVEDAD', motivo = 'la factura del QR es de OTRO proveedor (NIT distinto al del pedido)', factura_cufe = v_cufe where id = p_id; return 'NOVEDAD';
  end if;
  if p.factura_cufe is not null then
    if p.factura_cufe = v_cufe then
      update factura_foto set estado = 'AMARRADA', motivo = null, factura_cufe = v_cufe, amarrada_en = coalesce(amarrada_en, now()) where id = p_id; return 'AMARRADA';
    end if;
    update factura_foto set estado = 'NOVEDAD', motivo = 'el pedido ya tiene otra factura amarrada', factura_cufe = v_cufe where id = p_id; return 'NOVEDAD';
  end if;
  select numero into v_otro from pedidos where factura_cufe = v_cufe and id <> p.id limit 1;
  if v_otro is not null then
    update factura_foto set estado = 'NOVEDAD', motivo = 'esa factura ya está amarrada al pedido ' || v_otro, factura_cufe = v_cufe where id = p_id; return 'NOVEDAD';
  end if;

  update pedidos set factura_cufe = v_cufe, fecha_recibido = x.fecha_recibido, centro_costo = x.centro_costo
   where id = p.id and factura_cufe is null;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    update factura_foto set estado = 'NOVEDAD', motivo = 'no se pudo amarrar (revisa proveedor y pedido)', factura_cufe = v_cufe where id = p_id; return 'NOVEDAD';
  end if;
  -- la factura queda recibida por la sede del pedido (como al sellarla), con la foto como recibo
  update facturas set
      sede_id = case when estado in ('pool', 'asignada') then p.sede_id else coalesce(sede_id, p.sede_id) end,
      estado = case when estado in ('pool', 'asignada') then 'sellada'::estado_factura else estado end,
      asignada_en = coalesce(asignada_en, now()), sellada_en = coalesce(sellada_en, now()),
      sellada_por = coalesce(sellada_por, x.creado_por), recibido_por = coalesce(nullif(btrim(recibido_por), ''), x.recibido_por),
      archivo_recibo = coalesce(archivo_recibo, x.foto)
   where cufe = v_cufe;
  update factura_foto set estado = 'AMARRADA', motivo = null, factura_cufe = v_cufe, amarrada_en = now() where id = p_id;
  insert into historial (cufe, accion, detalle) values (v_cufe, 'pedido amarrado por foto', 'pedido ' || coalesce(p.numero, '') || ' · N° ' || x.numero);
  return 'AMARRADA';
end $$;
revoke all on function factura_foto_intentar(bigint) from public, anon, authenticated;

-- la sede (o admin/pagos) registra la foto desde el pedido -> { id, estado, motivo, documento }
create or replace function factura_foto_registrar(p_pedido_id bigint, p_numero text, p_foto text, p_fecha_recibido date,
  p_cufe_qr text default null, p_centro_costo text default null, p_recibido_por text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ped pedidos%rowtype; v_num text; v_cufe text; v_hoy date := (now() at time zone 'America/Bogota')::date; v_centro text := null;
  v_id bigint; v_estado text; x factura_foto%rowtype;
begin
  select * into v_ped from pedidos where id = p_pedido_id;
  if not found then raise exception 'Ese pedido no existe.' using errcode = '22023'; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and mi_rol() not in ('admin', 'pagos')
     and not (mi_rol() = 'sede' and (v_ped.sede_id = mi_sede() or v_ped.marca_id = mi_marca())) then
    raise exception 'Sin permiso para este pedido.' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and analista_restringido() and not (v_ped.sede_id = any (analista_sedes())) then
    raise exception 'Ese pedido es de otra sede.' using errcode = '42501';
  end if;
  if v_ped.estado = 'anulado' then raise exception 'Ese pedido está anulado.' using errcode = '22023'; end if;
  if v_ped.factura_cufe is not null then raise exception 'Ese pedido ya tiene una factura amarrada.' using errcode = '22023'; end if;
  v_num := upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_num = '' or v_num !~ '[0-9]' then raise exception 'Escribe el número de la factura (como sale en el papel).' using errcode = '22023'; end if;
  v_cufe := nullif(lower(btrim(coalesce(p_cufe_qr, ''))), '');
  if v_cufe is not null and v_cufe !~ '^[0-9a-f]{96}$' then v_cufe := null; end if;
  if coalesce(btrim(p_foto), '') = '' or p_foto not like 'fotos_factura/%' then raise exception 'Falta la foto de la factura.' using errcode = '22023'; end if;
  if p_fecha_recibido is null then raise exception 'Escribe la Fecha Recibido de la factura.' using errcode = '22023'; end if;
  if v_ped.fecha is not null and p_fecha_recibido < v_ped.fecha then
    raise exception 'La Fecha Recibido (%) no puede ser anterior a la fecha del pedido (%).', to_char(p_fecha_recibido, 'DD/MM/YYYY'), to_char(v_ped.fecha, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_fecha_recibido > v_hoy then raise exception 'La Fecha Recibido (%) no puede ser futura.', to_char(p_fecha_recibido, 'DD/MM/YYYY') using errcode = '22023'; end if;
  if exists (select 1 from centro_costo_serie where marca_id = v_ped.marca_id and activo) then
    if coalesce(btrim(p_centro_costo), '') = '' then raise exception 'Elige el centro de costo de la factura (Cocina, Bar...).' using errcode = '22023'; end if;
    if btrim(p_centro_costo) = 'VARIOS' then v_centro := 'VARIOS';
    else
      select serie_erp into v_centro from centro_costo_serie where marca_id = v_ped.marca_id and activo and serie_erp = btrim(p_centro_costo);
      if v_centro is null then raise exception 'El centro de costo "%" no existe para esta marca.', btrim(p_centro_costo) using errcode = '22023'; end if;
    end if;
  end if;
  -- una sola foto "viva" por pedido: la nueva reemplaza a la anterior que esperaba
  update factura_foto set estado = 'CANCELADA', motivo = 'reemplazada por otra foto' where pedido_id = p_pedido_id and estado in ('ESPERANDO', 'NOVEDAD');
  insert into factura_foto (pedido_id, numero, cufe_qr, foto, fecha_recibido, centro_costo, recibido_por)
  values (p_pedido_id, v_num, v_cufe, p_foto, p_fecha_recibido, v_centro, nullif(btrim(coalesce(p_recibido_por, '')), ''))
  returning id into v_id;
  v_estado := factura_foto_intentar(v_id);
  select * into x from factura_foto where id = v_id;
  return jsonb_build_object('id', v_id, 'estado', v_estado, 'motivo', x.motivo, 'numero', x.numero,
    'documento', (select coalesce(nullif(documento, ''), coalesce(prefijo, '') || coalesce(folio, '')) from facturas where cufe = x.factura_cufe));
end $$;
grant execute on function factura_foto_registrar(bigint, text, text, date, text, text, text) to authenticated;

-- volver a buscar las que esperan (boton de admin/pagos o el agente) -> cuantas se amarraron
create or replace function factura_foto_reintentar()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  for r in select id from factura_foto where estado in ('ESPERANDO', 'NOVEDAD') order by id loop
    if factura_foto_intentar(r.id) = 'AMARRADA' then n := n + 1; end if;
  end loop;
  return n;
end $$;
grant execute on function factura_foto_reintentar() to authenticated;

-- cuando una factura llega al banco (o se le completa el numero/NIT), se buscan las fotos que la esperaban.
-- NUNCA frena la carga de la factura: cualquier error queda en la foto como novedad, no en la factura.
create or replace function trg_factura_foto_llego()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.tipo is distinct from 'factura' then return null; end if;
  for r in select x.id from factura_foto x join pedidos p on p.id = x.pedido_id
            left join proveedores pr on pr.id = p.proveedor_id
           where x.estado = 'ESPERANDO'
             and (x.cufe_qr = new.cufe
                  or (nit_mismo_proveedor(coalesce(nullif(btrim(p.nit_proveedor), ''), pr.nit), new.nit_emisor) is true
                      and factura_numero_coincide(x.numero, new.prefijo, new.folio, new.documento))) loop
    begin
      perform factura_foto_intentar(r.id);
    exception when others then
      begin update factura_foto set estado = 'NOVEDAD', motivo = left('error al amarrar: ' || sqlerrm, 300) where id = r.id; exception when others then null; end;
    end;
  end loop;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists trg_factura_foto_llego_t on facturas;
create trigger trg_factura_foto_llego_t after insert or update of folio, prefijo, documento, nit_emisor on facturas
  for each row execute function trg_factura_foto_llego();
