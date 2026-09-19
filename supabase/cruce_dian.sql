-- ============================================================
--  CRUCE DIAN  (19/09/2026)  -  frescura real del reporte del ERP, verificacion final al encolar y proteccion contra duplicados
--  SOLO ADITIVO e idempotente. Ejecutar despues de conciliacion.sql, dian_descarga.sql y pdf_desbloqueo.sql.
--
--   erp_documento.hora / fecha_hora : la hora del documento en el ERP (columna "Hora" del reporte)
--   erp_carga.archivo_modificado    : cuando se genero el archivo (fecha de modificacion que informa el navegador)
--   erp_carga.corte                 : fecha y hora del ultimo documento que trae el reporte
--   cruce_config                    : ajustes del cruce (erp_max_horas = horas maximas de antiguedad del reporte del ERP)
--   cruce_encolar_verificado()      : ultima validacion EN LA BASE antes de encolar un documento (con bloqueo por CUFE)
--   ux_ordenes_ingresos_activa      : no puede haber dos ordenes de ingreso al ERP activas a la vez
-- ============================================================
alter table erp_documento add column if not exists hora time;
alter table erp_documento add column if not exists fecha_hora timestamp;            -- fecha + hora del ERP (hora de Colombia, sin zona)
create index if not exists ix_erp_documento_fecha_hora on erp_documento (fecha_hora);
alter table erp_carga add column if not exists archivo_modificado timestamptz;
alter table erp_carga add column if not exists corte timestamp;

create table if not exists cruce_config (
  clave          text primary key,
  valor          text not null,
  descripcion    text,
  actualizado_en timestamptz not null default now()
);
insert into cruce_config (clave, valor, descripcion) values
  ('erp_max_horas', '12', 'Horas maximas de antiguedad del reporte del ERP para poder mostrar un documento como PENDIENTE DE INGRESO')
on conflict (clave) do nothing;
alter table cruce_config enable row level security;
drop policy if exists cruce_config_leer on cruce_config;
create policy cruce_config_leer on cruce_config for select to authenticated using (mi_rol() in ('admin','pagos'));

-- Cargar el reporte: ahora tambien la hora de cada documento (misma firma que antes)
create or replace function erp_cargar_lote(p_carga bigint, p_docs jsonb) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int := 0; d jsonb; v_caus text; v_tipo text; v_fecha date; v_hora time;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para cargar el reporte del ERP'; end if;
  if not exists (select 1 from erp_carga where id = p_carga) then raise exception 'carga desconocida: %', p_carga; end if;
  if p_docs is null or jsonb_typeof(p_docs) <> 'array' then raise exception 'p_docs debe ser una lista'; end if;
  if jsonb_array_length(p_docs) > 1000 then raise exception 'maximo 1000 documentos por lote'; end if;
  for d in select * from jsonb_array_elements(p_docs) loop
    v_caus := upper(regexp_replace(coalesce(d->>'causacion',''), '[^A-Za-z0-9]', '', 'g'));
    v_tipo := coalesce(d->>'tipo','factura');
    if v_caus !~ '^[A-Z]+[0-9]+$' or v_tipo not in ('factura','nota_credito') then continue; end if;
    begin v_fecha := nullif(d->>'fecha','')::date; exception when others then v_fecha := null; end;
    begin v_hora := nullif(d->>'hora','')::time; exception when others then v_hora := null; end;
    insert into erp_documento (causacion, serie, numero, fecha, hora, fecha_hora, su_doc, su_doc_clave, contacto, contacto_norm, almacen, base, impuestos, neto, tipo, procesado, carga_id)
    values (v_caus, upper(coalesce(d->>'serie','')), coalesce(d->>'numero',''), v_fecha, v_hora, case when v_fecha is null then null else v_fecha + coalesce(v_hora, time '00:00') end,
            left(d->>'su_doc', 200), upper(regexp_replace(coalesce(d->>'su_doc',''), '[^A-Za-z0-9]', '', 'g')),
            left(d->>'contacto', 300), left(d->>'contacto_norm', 300), left(d->>'almacen', 120),
            coalesce(nullif(d->>'base','')::numeric, 0), coalesce(nullif(d->>'impuestos','')::numeric, 0), coalesce(nullif(d->>'neto','')::numeric, 0),
            v_tipo, coalesce((d->>'procesado')::boolean, false), p_carga)
    on conflict (causacion) do update set
      fecha = excluded.fecha, hora = excluded.hora, fecha_hora = excluded.fecha_hora, su_doc = excluded.su_doc, su_doc_clave = excluded.su_doc_clave, contacto = excluded.contacto,
      contacto_norm = excluded.contacto_norm, almacen = excluded.almacen, base = excluded.base, impuestos = excluded.impuestos, neto = excluded.neto, tipo = excluded.tipo,
      procesado = excluded.procesado, carga_id = excluded.carga_id, actualizado_en = now();
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- Cerrar la carga: ademas del resumen, el corte (hora del ultimo documento)
create or replace function erp_carga_cerrar(p_carga bigint) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para cargar el reporte del ERP'; end if;
  update erp_carga c set total = s.total, facturas = s.facturas, notas = s.notas, desde = s.desde, hasta = s.hasta, corte = s.corte
    from (select count(*)::int total, count(*) filter (where tipo = 'factura')::int facturas, count(*) filter (where tipo = 'nota_credito')::int notas,
                 min(fecha) desde, max(fecha) hasta, max(fecha_hora) corte from erp_documento where carga_id = p_carga) s
   where c.id = p_carga;
end $fn$;

-- Cuando se genero el archivo (el navegador informa su fecha de modificacion). No puede estar en el futuro.
create or replace function erp_carga_marcar_archivo(p_carga bigint, p_modificado timestamptz) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para cargar el reporte del ERP'; end if;
  update erp_carga set archivo_modificado = least(p_modificado, now()) where id = p_carga;
end $fn$;

-- ULTIMA VALIDACION antes de encolar (con bloqueo por CUFE: dos usuarios a la vez no pasan los dos):
--   1) el reporte del ERP debe ser reciente (erp_max_horas);  2) no esta ya en la web;  3) no la marcaron como ingresada;
--   4) no esta en el reporte del ERP (numero + proveedor iguales, o proveedor con alias confirmado);  5) recien entonces se encola (dian_encolar).
-- Cada item: { cufe, nit_emisor, nit_receptor, prefijo, folio, documento, emisor, emisor_norm, fecha_emision, total, tipo }
create or replace function cruce_encolar_verificado(p_items jsonb, p_marca int, p_usuario text default null)
returns table (o_cufe text, o_resultado text, o_motivo text)
language plpgsql security definer set search_path = public as $fn$
declare it jsonb; v_cufe text; v_doc text; v_doc0 text; v_nit text; v_norm text; v_tipo text; v_max int; v_datos timestamptz; r record;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para encolar descargas de la DIAN'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items debe ser una lista'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'maximo 500 documentos por envio'; end if;
  select coalesce(nullif(c.valor, '')::int, 12) into v_max from cruce_config c where c.clave = 'erp_max_horas';
  v_max := coalesce(v_max, 12);
  select coalesce(g.archivo_modificado, g.corte at time zone 'America/Bogota') into v_datos from erp_carga g where g.total is not null order by g.id desc limit 1;
  if v_datos is null or v_datos < now() - make_interval(hours => v_max) then
    raise exception 'ERP_DESACTUALIZADO: el reporte del ERP tiene mas de % horas (o no se sabe de cuando es). Carga un reporte nuevo.', v_max;
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_cufe := lower(regexp_replace(coalesce(it->>'cufe',''), '[^0-9a-fA-F]', '', 'g'));
    o_cufe := v_cufe;
    if length(v_cufe) <> 96 then o_resultado := 'INVALIDA'; o_motivo := 'CUFE invalido'; return next; continue; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_cufe, 7));                  -- dos clics a la vez: uno espera al otro y ve su resultado
    v_tipo := case when it->>'tipo' = 'nota_credito' then 'nota_credito' else 'factura' end;
    v_nit  := regexp_replace(coalesce(it->>'nit_emisor',''), '\D', '', 'g');
    v_norm := coalesce(it->>'emisor_norm', '');
    v_doc  := upper(regexp_replace(coalesce(it->>'prefijo','') || coalesce(it->>'folio',''), '[^A-Za-z0-9]', '', 'g'));
    v_doc0 := upper(regexp_replace(coalesce(it->>'prefijo',''), '[^A-Za-z0-9]', '', 'g')) || regexp_replace(regexp_replace(coalesce(it->>'folio',''), '[^A-Za-z0-9]', '', 'g'), '^0+(?=.)', '');
    if exists (select 1 from facturas f where lower(f.cufe) = v_cufe) then
      o_resultado := 'YA_EXISTE_EN_WEB'; o_motivo := 'el PDF ya está en la web'; return next; continue;
    end if;
    if exists (select 1 from conciliacion_decision d where d.cufe = v_cufe and d.decision = 'en_erp') then
      o_resultado := 'YA_EXISTE_EN_ERP'; o_motivo := 'una persona confirmó que ya está en el ERP'; return next; continue;
    end if;
    if v_doc <> '' and exists (select 1 from erp_documento e where e.su_doc_clave in (v_doc, v_doc0) and e.tipo = v_tipo
         and ((v_norm <> '' and e.contacto_norm = v_norm) or exists (select 1 from proveedor_alias a where a.nit = v_nit and a.nombre_erp_norm = e.contacto_norm))) then
      o_resultado := 'YA_EXISTE_EN_ERP'; o_motivo := 'el reporte del ERP ya trae este número con este proveedor'; return next; continue;
    end if;
    select * into r from dian_encolar(jsonb_build_array(it), p_marca, p_usuario);
    if r.encolados = 1 then o_resultado := 'ENCOLADA'; o_motivo := 'en la lista de descargas';
    elsif r.ya_en_cola = 1 then o_resultado := 'YA_EN_COLA'; o_motivo := 'ya estaba en la lista de descargas';
    elsif r.ya_en_sistema = 1 then o_resultado := 'YA_EXISTE_EN_WEB'; o_motivo := 'el PDF ya está en la web';
    else o_resultado := 'INVALIDA'; o_motivo := 'sin CUFE o NIT válido'; end if;
    return next;
  end loop;
end $fn$;

-- Nunca dos ordenes de ingreso al ERP activas a la vez (doble clic / dos usuarios)
create unique index if not exists ux_ordenes_ingresos_activa on ordenes (tipo) where tipo = 'ingresos' and estado in ('pendiente', 'corriendo');

revoke all on function erp_carga_marcar_archivo(bigint, timestamptz) from public, anon;
revoke all on function cruce_encolar_verificado(jsonb, int, text) from public, anon;
grant execute on function erp_carga_marcar_archivo(bigint, timestamptz) to authenticated, service_role;
grant execute on function cruce_encolar_verificado(jsonb, int, text) to authenticated, service_role;
