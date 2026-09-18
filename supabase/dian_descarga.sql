-- ============================================================
--  COLA DE DESCARGAS DIAN -> BANCO   (18/09/2026)
--  El admin marca facturas pendientes del cruce; el robot (en el PC) las baja de la DIAN
--  una por una y las sube al banco. SOLO ADITIVO e idempotente.
--  Estados: pendiente -> bajando -> subida | error -> (reintento) -> agotado
-- ============================================================
create table if not exists dian_descarga (
  id                 bigserial primary key,
  cufe               text not null unique,           -- en minusculas (igual que facturas.cufe)
  marca_id           int  not null references marcas(id),
  tipo               text not null default 'factura' check (tipo in ('factura','nota_credito')),
  categoria          categoria_doc not null default 'insumos',
  nit_emisor         text not null,
  nit_receptor       text,
  prefijo            text,
  folio              text,
  documento          text,
  emisor             text,
  fecha_emision      date,
  total              numeric(14,2),
  estado             text not null default 'pendiente' check (estado in ('pendiente','bajando','subida','error','agotado')),
  intentos           int  not null default 0,
  max_intentos       int  not null default 3,
  ultimo_error       text,
  ultimo_intento_en  timestamptz,
  proximo_intento_en timestamptz not null default now(),
  archivo_pdf        text,
  pedido_por         text,
  creado_en          timestamptz not null default now(),
  subida_en          timestamptz
);
create index if not exists ix_dian_descarga_estado on dian_descarga (estado, proximo_intento_en);
alter table dian_descarga enable row level security;
drop policy if exists dian_descarga_leer on dian_descarga;
create policy dian_descarga_leer on dian_descarga for select to authenticated using (mi_rol() in ('admin','pagos'));

-- Encolar (admin/pagos o el agente). No duplica: si ya esta en el banco o ya esta en la cola, lo cuenta y sigue.
create or replace function dian_encolar(p_items jsonb, p_marca int, p_usuario text default null)
returns table (encolados int, ya_en_sistema int, ya_en_cola int, invalidos int)
language plpgsql security definer set search_path = public as $fn$
declare it jsonb; v_cufe text; v_nit text; v_id bigint; v_cat categoria_doc;
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
    if length(v_cufe) <> 96 or v_nit = '' then n_inv := n_inv + 1; continue; end if;
    if exists (select 1 from facturas f where lower(f.cufe) = v_cufe) then n_sis := n_sis + 1; continue; end if;
    v_cat := coalesce((select c.categoria from categorias_proveedor c where c.nit = v_nit limit 1), 'insumos'::categoria_doc);
    begin v_fecha := nullif(it->>'fecha_emision','')::date; exception when others then v_fecha := null; end;
    begin v_total := nullif(it->>'total','')::numeric; exception when others then v_total := null; end;
    v_id := null;
    insert into dian_descarga (cufe, marca_id, categoria, nit_emisor, nit_receptor, prefijo, folio, documento, emisor, fecha_emision, total, pedido_por)
    values (v_cufe, p_marca, v_cat, v_nit, nullif(regexp_replace(coalesce(it->>'nit_receptor',''), '\D', '', 'g'), ''),
            nullif(it->>'prefijo',''), nullif(it->>'folio',''), nullif(it->>'documento',''), nullif(it->>'emisor',''), v_fecha, v_total, p_usuario)
    on conflict (cufe) do nothing returning dian_descarga.id into v_id;
    if v_id is not null then n_enc := n_enc + 1; continue; end if;
    update dian_descarga d set estado = 'pendiente', intentos = 0, proximo_intento_en = now(), marca_id = p_marca
     where d.cufe = v_cufe and d.estado in ('error','agotado') returning d.id into v_id;
    if v_id is not null then n_enc := n_enc + 1; else n_cola := n_cola + 1; end if;
  end loop;
  return query select n_enc, n_sis, n_cola, n_inv;
end $fn$;

-- Tomar las que toca bajar (solo el agente). Recupera las que quedaron "bajando" hace mas de 15 minutos.
create or replace function dian_tomar(p_limite int default 1)
returns setof dian_descarga language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente puede tomar descargas'; end if;
  update dian_descarga set estado = 'agotado', ultimo_error = coalesce(ultimo_error, 'el proceso se interrumpio en el ultimo intento')
   where estado = 'bajando' and ultimo_intento_en < now() - interval '15 minutes' and intentos >= max_intentos;
  update dian_descarga set estado = 'error', ultimo_error = coalesce(ultimo_error, 'el proceso se interrumpio'), proximo_intento_en = now()
   where estado = 'bajando' and ultimo_intento_en < now() - interval '15 minutes' and intentos < max_intentos;
  return query
  with cand as (
    select d.id from dian_descarga d
     where d.estado in ('pendiente','error') and d.proximo_intento_en <= now() and d.intentos < d.max_intentos
     order by d.proximo_intento_en, d.id limit p_limite for update skip locked)
  update dian_descarga d set estado = 'bajando', intentos = d.intentos + 1, ultimo_intento_en = now()
    from cand where d.id = cand.id returning d.*;
end $fn$;

-- Resultado de un intento (reintento con espera: 15 min, luego 1 h)
create or replace function dian_resultado(p_id bigint, p_ok boolean, p_error text default null, p_archivo text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v dian_descarga;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente puede registrar resultados'; end if;
  select * into v from dian_descarga where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update dian_descarga set estado = 'subida', subida_en = now(), archivo_pdf = p_archivo, ultimo_error = null where id = p_id;
  elsif v.intentos >= v.max_intentos then
    update dian_descarga set estado = 'agotado', ultimo_error = left(coalesce(p_error, 'error desconocido'), 1500) where id = p_id;
  else
    update dian_descarga set estado = 'error', ultimo_error = left(coalesce(p_error, 'error desconocido'), 1500),
      proximo_intento_en = now() + (case v.intentos when 1 then interval '15 minutes' else interval '1 hour' end) where id = p_id;
  end if;
end $fn$;

-- Reintento manual (admin/pagos)
create or replace function dian_reintentar(p_id bigint) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then
    raise exception 'sin permiso para reintentar descargas';
  end if;
  update dian_descarga set estado = 'pendiente', intentos = 0, proximo_intento_en = now() where id = p_id and estado in ('error','agotado');
end $fn$;

revoke all on function dian_encolar(jsonb,int,text) from public, anon;
revoke all on function dian_tomar(int) from public, anon, authenticated;
revoke all on function dian_resultado(bigint,boolean,text,text) from public, anon, authenticated;
revoke all on function dian_reintentar(bigint) from public, anon;
grant execute on function dian_encolar(jsonb,int,text) to authenticated, service_role;
grant execute on function dian_tomar(int) to service_role;
grant execute on function dian_resultado(bigint,boolean,text,text) to service_role;
grant execute on function dian_reintentar(bigint) to authenticated, service_role;

-- Devolver a la cola SIN gastar intento (la DIAN pidio verificacion humana y nadie la marco)  [18/09/2026]
create or replace function dian_devolver(p_id bigint, p_motivo text default null, p_espera_min int default 30)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente puede devolver descargas'; end if;
  update dian_descarga
     set estado = 'pendiente', intentos = greatest(intentos - 1, 0),
         ultimo_error = left(coalesce(p_motivo, 'devuelta a la cola'), 1500),
         proximo_intento_en = now() + make_interval(mins => greatest(coalesce(p_espera_min, 30), 0))
   where id = p_id and estado = 'bajando';
end $fn$;
revoke all on function dian_devolver(bigint,text,int) from public, anon, authenticated;
grant execute on function dian_devolver(bigint,text,int) to service_role;
