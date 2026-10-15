-- ============================================================
--  FOTO DE DOCUMENTOS EN EL PEDIDO: tipo de documento + novedad al recibir (15/10/2026, pedido del usuario)
--  (sigue a supabase/factura_foto.sql)
-- ============================================================
-- Tipo de documento de la foto:
--   factura       -> como antes: se busca en el banco (CUFE del QR o NIT + numero) y se amarra al pedido.
--   nota_credito  -> se busca en el banco (tipo nota_credito, mismo proveedor + numero) y se amarra a la FACTURA del pedido
--                    (nota_credito_factura). Si el pedido aun no tiene factura, espera y se amarra cuando la tenga.
--   devolucion / otro -> soporte del pedido (queda GUARDADA con su foto; no se busca nada).
-- Novedad al recibir (devolucion, faltante, danado, precio, otra + texto): se registra en novedades (la misma "Novedad" de la
-- factura que ve el analista en «Con novedad») en cuanto el pedido tiene su factura; si aun no la tiene, cuando la tenga.
-- Solo aditivo: columnas nuevas, la regla de estados se AMPLIA (GUARDADA), el indice de "una foto viva" pasa a ser por tipo, y
-- triggers nuevos que nunca frenan la carga de una factura ni el amarre de un pedido.

alter table factura_foto add column if not exists tipo_doc text not null default 'factura';
alter table factura_foto add column if not exists novedad_tipo text;
alter table factura_foto add column if not exists novedad text;
alter table factura_foto add column if not exists novedad_registrada boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'factura_foto_tipo_doc_valido') then
    alter table factura_foto add constraint factura_foto_tipo_doc_valido check (tipo_doc in ('factura', 'nota_credito', 'devolucion', 'otro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'factura_foto_novedad_tipo_valido') then
    alter table factura_foto add constraint factura_foto_novedad_tipo_valido check (novedad_tipo is null or novedad_tipo in ('devolucion', 'faltante', 'danado', 'precio', 'otra'));
  end if;
end $$;
-- estados: se agrega GUARDADA (devolucion / otro)
alter table factura_foto drop constraint if exists factura_foto_estado_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'factura_foto_estado_valido') then
    alter table factura_foto add constraint factura_foto_estado_valido check (estado in ('ESPERANDO', 'AMARRADA', 'NOVEDAD', 'CANCELADA', 'GUARDADA'));
  end if;
end $$;
-- una foto "viva" por pedido Y TIPO (antes: por pedido): asi pueden esperar a la vez la factura y su nota credito
create unique index if not exists factura_foto_una_viva_tipo on factura_foto (pedido_id, tipo_doc) where estado in ('ESPERANDO', 'NOVEDAD');
drop index if exists factura_foto_una_viva;

-- registra la NOVEDAD de una foto en novedades (cuando ya se conoce la factura del pedido). Interna.
create or replace function factura_foto_novedad(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare x factura_foto%rowtype; p pedidos%rowtype; v_cufe text; v_motivo text;
begin
  select * into x from factura_foto where id = p_id;
  if not found or x.novedad_tipo is null or x.novedad_registrada or x.estado = 'CANCELADA' then return; end if;
  select * into p from pedidos where id = x.pedido_id;
  v_cufe := case when x.tipo_doc = 'factura' and x.estado = 'AMARRADA' then x.factura_cufe else p.factura_cufe end;
  if v_cufe is null then return; end if;   -- el pedido aun no tiene factura: se registra cuando la tenga
  v_motivo := case x.novedad_tipo when 'devolucion' then 'Se devolvió algo' when 'faltante' then 'No llegó el pedido completo'
                when 'danado' then 'Producto en mal estado' when 'precio' then 'El precio no coincide' else 'Otra' end;
  insert into novedades (cufe, motivo, texto, foto, usuario, sede_id)
  values (v_cufe, v_motivo, coalesce(nullif(btrim(x.novedad), ''), v_motivo) || ' (pedido ' || coalesce(p.numero, '') || ', foto de ' ||
          case x.tipo_doc when 'nota_credito' then 'nota crédito' when 'devolucion' then 'devolución' when 'otro' then 'otro documento' else 'factura' end ||
          case when coalesce(x.numero, '') <> '' and x.numero <> 'SN' then ' ' || x.numero else '' end || ')', x.foto, x.creado_por, p.sede_id);
  update factura_foto set novedad_registrada = true where id = p_id;
end $$;
revoke all on function factura_foto_novedad(bigint) from public, anon, authenticated;

-- intenta amarrar UNA foto (misma firma de factura_foto.sql, ahora por tipo de documento). Interna.
create or replace function factura_foto_intentar(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  x factura_foto%rowtype; p pedidos%rowtype; v_nit text; v_cufe text; v_n integer; v_otro text; v_filas integer; v_tipo text; r record;
  v_nombre text;
begin
  select * into x from factura_foto where id = p_id for update;
  if not found or x.estado not in ('ESPERANDO', 'NOVEDAD') then return coalesce(x.estado, 'NO_EXISTE'); end if;
  select * into p from pedidos where id = x.pedido_id;
  update factura_foto set intentos = intentos + 1, ultimo_intento_en = now() where id = p_id;
  if p.estado = 'anulado' then
    update factura_foto set estado = 'CANCELADA', motivo = 'el pedido está anulado' where id = p_id; return 'CANCELADA';
  end if;
  v_tipo := coalesce(x.tipo_doc, 'factura');
  if v_tipo not in ('factura', 'nota_credito') then   -- devolucion / otro: soporte del pedido
    update factura_foto set estado = 'GUARDADA', motivo = null where id = p_id;
    perform factura_foto_novedad(p_id);
    return 'GUARDADA';
  end if;
  v_nombre := case v_tipo when 'nota_credito' then 'notas crédito' else 'facturas' end;
  select coalesce(nullif(btrim(p.nit_proveedor), ''), nullif(btrim(pr.nit), '')) into v_nit from proveedores pr where pr.id = p.proveedor_id;
  v_nit := coalesce(v_nit, nullif(btrim(p.nit_proveedor), ''));

  -- 1) CUFE exacto del QR; 2) mismo proveedor (NIT) + mismo numero, del mismo tipo de documento
  select count(*), min(f.cufe) into v_n, v_cufe from facturas f
   where f.tipo::text = v_tipo and f.estado <> 'rechazada'
     and ((x.cufe_qr is not null and f.cufe = x.cufe_qr)
          or (x.cufe_qr is null and v_nit is not null and nit_mismo_proveedor(v_nit, f.nit_emisor) is true
              and factura_numero_coincide(x.numero, f.prefijo, f.folio, f.documento)));
  if v_n = 0 and x.cufe_qr is not null and v_nit is not null then
    select count(*), min(f.cufe) into v_n, v_cufe from facturas f
     where f.tipo::text = v_tipo and f.estado <> 'rechazada' and nit_mismo_proveedor(v_nit, f.nit_emisor) is true
       and factura_numero_coincide(x.numero, f.prefijo, f.folio, f.documento);
  end if;
  if v_n = 0 then
    if v_nit is null and x.cufe_qr is null then
      update factura_foto set estado = 'NOVEDAD', motivo = 'el pedido no tiene el NIT del proveedor: amárrala a mano' where id = p_id; return 'NOVEDAD';
    end if;
    update factura_foto set estado = 'ESPERANDO', motivo = null where id = p_id; return 'ESPERANDO';
  end if;
  if v_n > 1 then
    update factura_foto set estado = 'NOVEDAD', motivo = v_n || ' ' || v_nombre || ' del proveedor tienen ese número: amárrala a mano' where id = p_id; return 'NOVEDAD';
  end if;
  if v_nit is not null and nit_mismo_proveedor(v_nit, (select nit_emisor from facturas where cufe = v_cufe)) is false then
    update factura_foto set estado = 'NOVEDAD', motivo = 'el documento del QR es de OTRO proveedor (NIT distinto al del pedido)', factura_cufe = v_cufe where id = p_id; return 'NOVEDAD';
  end if;

  -- NOTA CREDITO: va a la factura del pedido
  if v_tipo = 'nota_credito' then
    if p.factura_cufe is null then
      update factura_foto set estado = 'ESPERANDO', motivo = 'la nota está en el banco; se amarra cuando el pedido tenga su factura', factura_cufe = v_cufe where id = p_id;
      return 'ESPERANDO';
    end if;
    insert into nota_credito_factura (nota_cufe, factura_cufe, creado_por) values (v_cufe, p.factura_cufe, 'foto de la sede')
      on conflict (nota_cufe, factura_cufe) do nothing;
    update pedidos set numero_nota_credito = (select coalesce(nullif(documento, ''), coalesce(prefijo, '') || coalesce(folio, '')) from facturas where cufe = v_cufe)
     where id = p.id and coalesce(btrim(numero_nota_credito), '') = '';
    update factura_foto set estado = 'AMARRADA', motivo = null, factura_cufe = v_cufe, amarrada_en = now() where id = p_id;
    insert into historial (cufe, accion, detalle) values (v_cufe, 'nota crédito amarrada por foto', 'pedido ' || coalesce(p.numero, '') || ' · N° ' || x.numero);
    perform factura_foto_novedad(p_id);
    return 'AMARRADA';
  end if;

  -- FACTURA (igual que antes)
  if p.factura_cufe is not null then
    if p.factura_cufe = v_cufe then
      update factura_foto set estado = 'AMARRADA', motivo = null, factura_cufe = v_cufe, amarrada_en = coalesce(amarrada_en, now()) where id = p_id;
      perform factura_foto_novedad(p_id);
      return 'AMARRADA';
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
  update facturas set
      sede_id = case when estado in ('pool', 'asignada') then p.sede_id else coalesce(sede_id, p.sede_id) end,
      estado = case when estado in ('pool', 'asignada') then 'sellada'::estado_factura else estado end,
      asignada_en = coalesce(asignada_en, now()), sellada_en = coalesce(sellada_en, now()),
      sellada_por = coalesce(sellada_por, x.creado_por), recibido_por = coalesce(nullif(btrim(recibido_por), ''), x.recibido_por),
      archivo_recibo = coalesce(archivo_recibo, x.foto)
   where cufe = v_cufe;
  update factura_foto set estado = 'AMARRADA', motivo = null, factura_cufe = v_cufe, amarrada_en = now() where id = p_id;
  insert into historial (cufe, accion, detalle) values (v_cufe, 'pedido amarrado por foto', 'pedido ' || coalesce(p.numero, '') || ' · N° ' || x.numero);
  perform factura_foto_novedad(p_id);
  -- (el trigger de pedidos completa las notas credito y novedades de este pedido que esperaban la factura)
  return 'AMARRADA';
end $$;
revoke all on function factura_foto_intentar(bigint) from public, anon, authenticated;

-- cuando el pedido queda con factura (por foto o a mano): notas credito y novedades de sus fotos que esperaban. Nunca frena el amarre.
create or replace function factura_foto_pedido_con_factura(p_pedido bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from factura_foto where pedido_id = p_pedido and tipo_doc = 'nota_credito' and estado in ('ESPERANDO', 'NOVEDAD') loop
    begin perform factura_foto_intentar(r.id); exception when others then null; end;
  end loop;
  for r in select id from factura_foto where pedido_id = p_pedido and novedad_tipo is not null and not novedad_registrada and estado <> 'CANCELADA' loop
    begin perform factura_foto_novedad(r.id); exception when others then null; end;
  end loop;
end $$;
revoke all on function factura_foto_pedido_con_factura(bigint) from public, anon, authenticated;

create or replace function trg_factura_foto_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.factura_cufe is not null and new.factura_cufe is distinct from old.factura_cufe then
    perform factura_foto_pedido_con_factura(new.id);
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists trg_factura_foto_pedido_t on pedidos;
create trigger trg_factura_foto_pedido_t after update of factura_cufe on pedidos
  for each row execute function trg_factura_foto_pedido();

-- cuando una FACTURA o NOTA CREDITO llega al banco: las fotos de ese tipo que la esperaban
create or replace function trg_factura_foto_llego()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.tipo::text not in ('factura', 'nota_credito') then return null; end if;
  for r in select x.id from factura_foto x join pedidos p on p.id = x.pedido_id
            left join proveedores pr on pr.id = p.proveedor_id
           where x.estado = 'ESPERANDO' and x.tipo_doc = new.tipo::text
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

-- registrar: ahora con tipo de documento y novedad (la version anterior de 7 parametros se reemplaza: misma llamada + 3 opcionales)
drop function if exists factura_foto_registrar(bigint, text, text, date, text, text, text);
create or replace function factura_foto_registrar(p_pedido_id bigint, p_numero text, p_foto text, p_fecha_recibido date,
  p_cufe_qr text default null, p_centro_costo text default null, p_recibido_por text default null,
  p_tipo text default 'factura', p_novedad_tipo text default null, p_novedad text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ped pedidos%rowtype; v_num text; v_cufe text; v_hoy date := (now() at time zone 'America/Bogota')::date; v_centro text := null;
  v_id bigint; v_estado text; x factura_foto%rowtype; v_tipo text; v_nt text; v_nov text;
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
  v_tipo := lower(btrim(coalesce(p_tipo, 'factura')));
  if v_tipo not in ('factura', 'nota_credito', 'devolucion', 'otro') then raise exception 'Tipo de documento no válido.' using errcode = '22023'; end if;
  if v_tipo = 'factura' and v_ped.factura_cufe is not null then raise exception 'Ese pedido ya tiene una factura amarrada.' using errcode = '22023'; end if;
  v_num := upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_tipo in ('factura', 'nota_credito') and (v_num = '' or v_num !~ '[0-9]') then
    raise exception 'Escribe el número del documento (como sale en el papel).' using errcode = '22023';
  end if;
  if v_num = '' then v_num := 'SN'; end if;   -- devolucion / otro sin numero
  v_cufe := nullif(lower(btrim(coalesce(p_cufe_qr, ''))), '');
  if v_cufe is not null and v_cufe !~ '^[0-9a-f]{96}$' then v_cufe := null; end if;
  if v_tipo not in ('factura', 'nota_credito') then v_cufe := null; end if;
  if coalesce(btrim(p_foto), '') = '' or p_foto not like 'fotos_factura/%' then raise exception 'Falta la foto del documento.' using errcode = '22023'; end if;
  if p_fecha_recibido is null then raise exception 'Escribe la fecha del documento.' using errcode = '22023'; end if;
  if p_fecha_recibido > v_hoy then raise exception 'La fecha (%) no puede ser futura.', to_char(p_fecha_recibido, 'DD/MM/YYYY') using errcode = '22023'; end if;
  if v_tipo = 'factura' then   -- la factura se amarra al pedido: mismas reglas de siempre
    if v_ped.fecha is not null and p_fecha_recibido < v_ped.fecha then
      raise exception 'La Fecha Recibido (%) no puede ser anterior a la fecha del pedido (%).', to_char(p_fecha_recibido, 'DD/MM/YYYY'), to_char(v_ped.fecha, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    if exists (select 1 from centro_costo_serie where marca_id = v_ped.marca_id and activo) then
      if coalesce(btrim(p_centro_costo), '') = '' then raise exception 'Elige el centro de costo de la factura (Cocina, Bar...).' using errcode = '22023'; end if;
      if btrim(p_centro_costo) = 'VARIOS' then v_centro := 'VARIOS';
      else
        select serie_erp into v_centro from centro_costo_serie where marca_id = v_ped.marca_id and activo and serie_erp = btrim(p_centro_costo);
        if v_centro is null then raise exception 'El centro de costo "%" no existe para esta marca.', btrim(p_centro_costo) using errcode = '22023'; end if;
      end if;
    end if;
  end if;
  v_nt := nullif(lower(btrim(coalesce(p_novedad_tipo, ''))), '');
  if v_nt is not null and v_nt not in ('devolucion', 'faltante', 'danado', 'precio', 'otra') then raise exception 'Tipo de novedad no válido.' using errcode = '22023'; end if;
  v_nov := nullif(btrim(coalesce(p_novedad, '')), '');
  if v_nt is not null and v_nov is null then raise exception 'Escribe qué pasó (la novedad).' using errcode = '22023'; end if;
  if v_nt is null then v_nov := null; end if;
  if length(coalesce(v_nov, '')) > 1000 then raise exception 'La novedad es muy larga (máximo 1000 letras).' using errcode = '22023'; end if;
  update factura_foto set estado = 'CANCELADA', motivo = 'reemplazada por otra foto'
   where pedido_id = p_pedido_id and tipo_doc = v_tipo and estado in ('ESPERANDO', 'NOVEDAD');
  insert into factura_foto (pedido_id, numero, cufe_qr, foto, fecha_recibido, centro_costo, recibido_por, tipo_doc, novedad_tipo, novedad)
  values (p_pedido_id, v_num, v_cufe, p_foto, p_fecha_recibido, v_centro, nullif(btrim(coalesce(p_recibido_por, '')), ''), v_tipo, v_nt, v_nov)
  returning id into v_id;
  v_estado := factura_foto_intentar(v_id);
  select * into x from factura_foto where id = v_id;
  return jsonb_build_object('id', v_id, 'estado', v_estado, 'motivo', x.motivo, 'numero', x.numero, 'tipo', x.tipo_doc,
    'novedad_registrada', x.novedad_registrada,
    'documento', (select coalesce(nullif(documento, ''), coalesce(prefijo, '') || coalesce(folio, '')) from facturas where cufe = x.factura_cufe));
end $$;
grant execute on function factura_foto_registrar(bigint, text, text, date, text, text, text, text, text, text) to authenticated;
