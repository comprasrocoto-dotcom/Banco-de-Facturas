-- ============================================================
--  CONCILIACION DIAN <-> WEB <-> ERP   (18/09/2026)
--  SOLO ADITIVO e idempotente: tablas nuevas + funciones nuevas. No borra ni cambia datos existentes.
--  Ejecutar DESPUES de dian_descarga.sql (redefine dian_encolar para aceptar tipo = nota_credito, misma firma).
--
--  erp_carga / erp_documento : copia (espejo) del reporte "Documentos" de Hiopos (Su Doc = N. de factura del proveedor)
--  proveedor_alias           : NIT <-> nombre del contacto en el ERP, confirmado por una persona (conocimiento estructurado, sin IA)
--  conciliacion_decision     : correcciones de una persona ("esta SI esta en el ERP como FCRC3423", "NO esta") y, en notas
--                              credito, la factura a la que corresponden
--  conciliacion_corrida / _resultado : registro de auditoria de cada conciliacion, re-verificacion y carga
-- ============================================================

-- ---------- espejo del ERP ----------
create table if not exists erp_carga (
  id          bigserial primary key,
  archivo     text,
  cargado_por text,
  cargado_en  timestamptz not null default now(),
  total       int,
  facturas    int,
  notas       int,
  desde       date,
  hasta       date
);
create table if not exists erp_documento (
  causacion      text primary key,                     -- FCRC3423 (serie + numero, sin espacios; igual a facturas.num_ingreso)
  serie          text not null,
  numero         text not null,
  fecha          date,
  su_doc         text,                                 -- N. de factura del proveedor, tal como lo escribieron en el ERP
  su_doc_clave   text,                                 -- solo letras y numeros, mayusculas
  contacto       text,
  contacto_norm  text,                                 -- nombre normalizado (sin S.A.S., tildes, conectores)
  almacen        text,
  base           numeric(16,2) not null default 0,
  impuestos      numeric(16,2) not null default 0,
  neto           numeric(16,2) not null default 0,
  tipo           text not null check (tipo in ('factura','nota_credito')),
  procesado      boolean not null default false,
  carga_id       bigint references erp_carga(id),
  actualizado_en timestamptz not null default now()
);
create index if not exists ix_erp_documento_clave    on erp_documento (su_doc_clave);
create index if not exists ix_erp_documento_contacto on erp_documento (contacto_norm);
create index if not exists ix_erp_documento_fecha    on erp_documento (fecha);

-- ---------- conocimiento confirmado por personas ----------
create table if not exists proveedor_alias (
  id              bigserial primary key,
  nit             text not null,
  nombre_erp_norm text not null,
  nombre_erp      text,
  creado_por      text,
  creado_en       timestamptz not null default now(),
  unique (nit, nombre_erp_norm)
);
create table if not exists conciliacion_decision (
  cufe               text primary key,                 -- en minusculas (igual que facturas.cufe)
  decision           text check (decision is null or decision in ('en_erp','no_esta')),
  causacion_erp      text,                             -- con que numero de causacion quedo en el ERP (FCRC3423)
  factura_relacionada text,                            -- solo notas credito: N. de la factura a la que corresponde
  nota               text,
  decidido_por       text,
  decidido_en        timestamptz not null default now()
);

-- ---------- auditoria ----------
create table if not exists conciliacion_corrida (
  id           bigserial primary key,
  creada_en    timestamptz not null default now(),
  usuario      text,
  tipo         text not null,                          -- 'conciliar' | 'subir_facturas' | 'subir_notas_credito'
  erp_carga_id bigint,
  resumen      jsonb
);
create table if not exists conciliacion_resultado (
  id            bigserial primary key,
  corrida_id    bigint references conciliacion_corrida(id),
  creado_en     timestamptz not null default now(),
  momento       text not null default 'conciliacion',  -- conciliacion | reverificacion | carga | decision
  cufe          text,
  documento     text,
  tipo          text,
  proveedor     text,
  nit_emisor    text,
  fecha_emision date,
  res_dian      text,
  res_web       text,
  res_erp       text,
  resultado     text,
  motivo        text,
  causacion_erp text
);
create index if not exists ix_conc_res_corrida on conciliacion_resultado (corrida_id);
create index if not exists ix_conc_res_cufe    on conciliacion_resultado (cufe, creado_en desc);

-- ---------- seguridad: leen admin/pagos; se escribe SOLO con las funciones de abajo ----------
alter table erp_carga              enable row level security;
alter table erp_documento          enable row level security;
alter table proveedor_alias        enable row level security;
alter table conciliacion_decision  enable row level security;
alter table conciliacion_corrida   enable row level security;
alter table conciliacion_resultado enable row level security;
do $p$ declare t text; begin
  foreach t in array array['erp_carga','erp_documento','proveedor_alias','conciliacion_decision','conciliacion_corrida','conciliacion_resultado'] loop
    execute format('drop policy if exists %I on %I', t || '_leer', t);
    execute format('create policy %I on %I for select to authenticated using (mi_rol() in (''admin'',''pagos''))', t || '_leer', t);
  end loop;
end $p$;

-- ---------- cargar el reporte del ERP (nunca borra: solo agrega o actualiza por N. de causacion) ----------
create or replace function erp_carga_iniciar(p_archivo text, p_usuario text default null) returns bigint
language plpgsql security definer set search_path = public as $fn$
declare v_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para cargar el reporte del ERP'; end if;
  insert into erp_carga (archivo, cargado_por) values (left(p_archivo, 200), left(p_usuario, 120)) returning id into v_id;
  return v_id;
end $fn$;

create or replace function erp_cargar_lote(p_carga bigint, p_docs jsonb) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int := 0; d jsonb; v_caus text; v_tipo text; v_fecha date;
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
    insert into erp_documento (causacion, serie, numero, fecha, su_doc, su_doc_clave, contacto, contacto_norm, almacen, base, impuestos, neto, tipo, procesado, carga_id)
    values (v_caus, upper(coalesce(d->>'serie','')), coalesce(d->>'numero',''), v_fecha, left(d->>'su_doc', 200), upper(regexp_replace(coalesce(d->>'su_doc',''), '[^A-Za-z0-9]', '', 'g')),
            left(d->>'contacto', 300), left(d->>'contacto_norm', 300), left(d->>'almacen', 120),
            coalesce(nullif(d->>'base','')::numeric, 0), coalesce(nullif(d->>'impuestos','')::numeric, 0), coalesce(nullif(d->>'neto','')::numeric, 0),
            v_tipo, coalesce((d->>'procesado')::boolean, false), p_carga)
    on conflict (causacion) do update set
      fecha = excluded.fecha, su_doc = excluded.su_doc, su_doc_clave = excluded.su_doc_clave, contacto = excluded.contacto, contacto_norm = excluded.contacto_norm,
      almacen = excluded.almacen, base = excluded.base, impuestos = excluded.impuestos, neto = excluded.neto, tipo = excluded.tipo,
      procesado = excluded.procesado, carga_id = excluded.carga_id, actualizado_en = now();
    n := n + 1;
  end loop;
  return n;
end $fn$;

create or replace function erp_carga_cerrar(p_carga bigint) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para cargar el reporte del ERP'; end if;
  update erp_carga c set total = s.total, facturas = s.facturas, notas = s.notas, desde = s.desde, hasta = s.hasta
    from (select count(*)::int total, count(*) filter (where tipo = 'factura')::int facturas, count(*) filter (where tipo = 'nota_credito')::int notas,
                 min(fecha) desde, max(fecha) hasta from erp_documento where carga_id = p_carga) s
   where c.id = p_carga;
end $fn$;

-- ---------- correcciones de una persona ----------
-- p_decision: 'en_erp' | 'no_esta' | 'ninguna' (quita la decision y deja solo la factura relacionada / nota)
create or replace function conciliacion_decidir(p_cufe text, p_decision text, p_causacion text default null, p_factura_rel text default null, p_nota text default null,
                                                p_nit text default null, p_contacto_erp text default null, p_contacto_norm text default null, p_usuario text default null,
                                                p_documento text default null, p_proveedor text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_cufe text; v_dec text; v_caus text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para registrar decisiones'; end if;
  v_cufe := lower(regexp_replace(coalesce(p_cufe,''), '[^0-9a-fA-F]', '', 'g'));
  if length(v_cufe) <> 96 then raise exception 'CUFE invalido'; end if;
  if p_decision is not null and p_decision not in ('en_erp','no_esta','ninguna') then raise exception 'decision desconocida: %', p_decision; end if;
  v_dec := case when p_decision in ('en_erp','no_esta') then p_decision else null end;
  v_caus := nullif(upper(regexp_replace(coalesce(p_causacion,''), '[^A-Za-z0-9]', '', 'g')), '');
  insert into conciliacion_decision (cufe, decision, causacion_erp, factura_relacionada, nota, decidido_por)
  values (v_cufe, v_dec, v_caus, nullif(left(trim(coalesce(p_factura_rel,'')), 100), ''), nullif(left(trim(coalesce(p_nota,'')), 500), ''), left(p_usuario, 120))
  on conflict (cufe) do update set decision = excluded.decision, causacion_erp = excluded.causacion_erp, factura_relacionada = excluded.factura_relacionada,
     nota = excluded.nota, decidido_por = excluded.decidido_por, decidido_en = now();
  if v_dec = 'en_erp' and coalesce(p_nit,'') <> '' and coalesce(p_contacto_norm,'') <> '' then
    insert into proveedor_alias (nit, nombre_erp_norm, nombre_erp, creado_por)
    values (regexp_replace(p_nit, '\D', '', 'g'), left(p_contacto_norm, 300), left(p_contacto_erp, 300), left(p_usuario, 120)) on conflict (nit, nombre_erp_norm) do nothing;
  end if;
  insert into conciliacion_resultado (momento, cufe, documento, proveedor, resultado, motivo, causacion_erp)
  values ('decision', v_cufe, left(p_documento, 100), left(p_proveedor, 300), coalesce(v_dec, 'sin_decision'),
          left('Decision de ' || coalesce(p_usuario, '?') || coalesce(': ' || p_nota, '') || coalesce(' · factura relacionada ' || nullif(trim(p_factura_rel), ''), ''), 900), v_caus);
end $fn$;

-- ---------- auditoria ----------
create or replace function conciliacion_registrar(p_tipo text, p_resumen jsonb, p_filas jsonb, p_corrida bigint default null, p_usuario text default null, p_carga bigint default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare v_id bigint := p_corrida;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then raise exception 'sin permiso para registrar la auditoria'; end if;
  if p_filas is not null and jsonb_typeof(p_filas) <> 'array' then raise exception 'p_filas debe ser una lista'; end if;
  if p_filas is not null and jsonb_array_length(p_filas) > 1000 then raise exception 'maximo 1000 filas por llamada'; end if;
  if v_id is null then
    insert into conciliacion_corrida (usuario, tipo, erp_carga_id, resumen) values (left(p_usuario, 120), left(p_tipo, 40), p_carga, p_resumen) returning id into v_id;
  elsif not exists (select 1 from conciliacion_corrida where id = v_id) then raise exception 'corrida desconocida: %', v_id;
  end if;
  if p_filas is not null then
    insert into conciliacion_resultado (corrida_id, momento, cufe, documento, tipo, proveedor, nit_emisor, fecha_emision, res_dian, res_web, res_erp, resultado, motivo, causacion_erp)
    select v_id, coalesce(x.momento, 'conciliacion'), lower(x.cufe), left(x.documento, 100), left(x.tipo, 30), left(x.proveedor, 300), left(x.nit_emisor, 30), x.fecha_emision,
           left(x.res_dian, 30), left(x.res_web, 30), left(x.res_erp, 30), left(x.resultado, 60), left(x.motivo, 900), left(x.causacion_erp, 60)
      from jsonb_to_recordset(p_filas) as x(momento text, cufe text, documento text, tipo text, proveedor text, nit_emisor text, fecha_emision date,
                                            res_dian text, res_web text, res_erp text, resultado text, motivo text, causacion_erp text);
  end if;
  return v_id;
end $fn$;

-- ---------- cola de descargas: ahora tambien notas credito (misma firma que antes; el resto no cambia) ----------
create or replace function dian_encolar(p_items jsonb, p_marca int, p_usuario text default null)
returns table (encolados int, ya_en_sistema int, ya_en_cola int, invalidos int)
language plpgsql security definer set search_path = public as $fn$
declare it jsonb; v_cufe text; v_nit text; v_id bigint; v_cat categoria_doc; v_tipo text;
        v_fecha date; v_total numeric; n_enc int := 0; n_sis int := 0; n_cola int := 0; n_inv int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then
    raise exception 'sin permiso para encolar descargas de la DIAN';
  end if;
  if not exists (select 1 from marcas where id = p_marca) then raise exception 'marca desconocida: %', p_marca; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items debe ser una lista'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'maximo 500 facturas por envio'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_cufe := lower(regexp_replace(coalesce(it->>'cufe',''), '[^0-9a-fA-F]', '', 'g'));
    v_nit  := regexp_replace(coalesce(it->>'nit_emisor',''), '\D', '', 'g');
    v_tipo := case when it->>'tipo' = 'nota_credito' then 'nota_credito' else 'factura' end;
    if length(v_cufe) <> 96 or v_nit = '' then n_inv := n_inv + 1; continue; end if;
    if exists (select 1 from facturas f where lower(f.cufe) = v_cufe) then n_sis := n_sis + 1; continue; end if;
    v_cat := coalesce((select c.categoria from categorias_proveedor c where c.nit = v_nit limit 1), 'insumos'::categoria_doc);
    begin v_fecha := nullif(it->>'fecha_emision','')::date; exception when others then v_fecha := null; end;
    begin v_total := nullif(it->>'total','')::numeric; exception when others then v_total := null; end;
    v_id := null;
    insert into dian_descarga (cufe, marca_id, tipo, categoria, nit_emisor, nit_receptor, prefijo, folio, documento, emisor, fecha_emision, total, pedido_por)
    values (v_cufe, p_marca, v_tipo, v_cat, v_nit, nullif(regexp_replace(coalesce(it->>'nit_receptor',''), '\D', '', 'g'), ''),
            nullif(it->>'prefijo',''), nullif(it->>'folio',''), nullif(it->>'documento',''), nullif(it->>'emisor',''), v_fecha, v_total, p_usuario)
    on conflict (cufe) do nothing returning dian_descarga.id into v_id;
    if v_id is not null then n_enc := n_enc + 1; continue; end if;
    update dian_descarga d set estado = 'pendiente', intentos = 0, proximo_intento_en = now(), marca_id = p_marca, tipo = v_tipo
     where d.cufe = v_cufe and d.estado in ('error','agotado') returning d.id into v_id;
    if v_id is not null then n_enc := n_enc + 1; else n_cola := n_cola + 1; end if;
  end loop;
  return query select n_enc, n_sis, n_cola, n_inv;
end $fn$;

revoke all on function erp_carga_iniciar(text,text) from public, anon;
revoke all on function erp_cargar_lote(bigint,jsonb) from public, anon;
revoke all on function erp_carga_cerrar(bigint) from public, anon;
revoke all on function conciliacion_decidir(text,text,text,text,text,text,text,text,text,text,text) from public, anon;
revoke all on function conciliacion_registrar(text,jsonb,jsonb,bigint,text,bigint) from public, anon;
revoke all on function dian_encolar(jsonb,int,text) from public, anon;
grant execute on function erp_carga_iniciar(text,text) to authenticated, service_role;
grant execute on function erp_cargar_lote(bigint,jsonb) to authenticated, service_role;
grant execute on function erp_carga_cerrar(bigint) to authenticated, service_role;
grant execute on function conciliacion_decidir(text,text,text,text,text,text,text,text,text,text,text) to authenticated, service_role;
grant execute on function conciliacion_registrar(text,jsonb,jsonb,bigint,text,bigint) to authenticated, service_role;
grant execute on function dian_encolar(jsonb,int,text) to authenticated, service_role;
