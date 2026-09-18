-- ============================================================
--  COLA DE CORREOS CON ESTADOS Y REINTENTOS   (18/09/2026)
--  SOLO ADITIVO e idempotente.
--  Estados: pendiente -> enviando -> enviado | error -> (reintento) -> ... -> agotado
--  El envio real sigue siendo Gmail API (agent_factura_v2/enviar-correo.js).
-- ============================================================
create table if not exists correo_cola (
  id                  bigserial primary key,
  destinatario        text not null,
  asunto              text not null,
  cuerpo              text not null,
  factura_cufe        text,
  pedido_numero       text,
  orden_id            bigint,
  dedupe_key          text not null,   -- md5(destinatario|asunto|cuerpo) + dia (hora Colombia): evita duplicados
  estado              text not null default 'pendiente' check (estado in ('pendiente','enviando','enviado','error','agotado')),
  intentos            int  not null default 0,
  max_intentos        int  not null default 5,
  ultimo_error        text,
  ultimo_intento_en   timestamptz,
  proximo_intento_en  timestamptz not null default now(),
  creado_en           timestamptz not null default now(),
  enviado_en          timestamptz,
  gmail_id            text,
  unique (dedupe_key)
);
create index if not exists ix_correo_cola_estado on correo_cola (estado, proximo_intento_en);
alter table correo_cola enable row level security;
drop policy if exists correo_cola_leer on correo_cola;
create policy correo_cola_leer on correo_cola for select to authenticated using (mi_rol() in ('admin','pagos'));

-- Encolar (no duplica el mismo correo el mismo dia; si estaba agotado lo reabre)
create or replace function correo_encolar(
  p_para text, p_asunto text, p_cuerpo text, p_cufe text default null, p_pedido text default null, p_orden bigint default null
) returns table (correo_id bigint, duplicado boolean) language plpgsql security definer set search_path = public as $fn$
declare v_key text; v_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then
    raise exception 'sin permiso para encolar correos';
  end if;
  v_key := md5(lower(trim(p_para)) || '|' || p_asunto || '|' || p_cuerpo) || '|' || to_char(timezone('America/Bogota', now()), 'YYYY-MM-DD');
  insert into correo_cola (destinatario, asunto, cuerpo, factura_cufe, pedido_numero, orden_id, dedupe_key)
  values (trim(p_para), p_asunto, p_cuerpo, p_cufe, p_pedido, p_orden, v_key)
  on conflict (dedupe_key) do nothing
  returning correo_cola.id into v_id;
  if v_id is not null then
    return query select v_id, false; return;
  end if;
  update correo_cola c set estado = 'pendiente', intentos = 0, proximo_intento_en = now()
   where c.dedupe_key = v_key and c.estado = 'agotado' returning c.id into v_id;
  if v_id is null then select c.id into v_id from correo_cola c where c.dedupe_key = v_key; end if;
  return query select v_id, true;
end $fn$;

-- Tomar los correos que toca enviar (bloquea filas: dos procesos no toman el mismo)
create or replace function correo_tomar(p_limite int default 1)
returns setof correo_cola language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente puede tomar correos'; end if;
  -- un intento que murio a medias en el ultimo intento no se puede reintentar: queda como agotado
  update correo_cola set estado = 'agotado', ultimo_error = coalesce(ultimo_error, 'el proceso se interrumpio durante el ultimo intento')
   where estado = 'enviando' and ultimo_intento_en < now() - interval '10 minutes' and intentos >= max_intentos;
  return query
  with cand as (
    select c.id from correo_cola c
     where (c.estado in ('pendiente','error') and c.proximo_intento_en <= now() and c.intentos < c.max_intentos)
        or (c.estado = 'enviando' and c.ultimo_intento_en < now() - interval '10 minutes' and c.intentos < c.max_intentos)
     order by c.proximo_intento_en, c.id
     limit p_limite
     for update skip locked)
  update correo_cola c set estado = 'enviando', intentos = c.intentos + 1, ultimo_intento_en = now()
    from cand where c.id = cand.id
  returning c.*;
end $fn$;

-- Registrar el resultado de un intento (reintento con espera creciente: 2 min, 10 min, 30 min, 2 h)
create or replace function correo_resultado(p_id bigint, p_ok boolean, p_error text default null, p_gmail_id text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v correo_cola;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente puede registrar resultados'; end if;
  select * into v from correo_cola where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update correo_cola set estado = 'enviado', enviado_en = now(), gmail_id = p_gmail_id where id = p_id;
  elsif v.intentos >= v.max_intentos then
    update correo_cola set estado = 'agotado', ultimo_error = left(coalesce(p_error, 'error desconocido'), 1500) where id = p_id;
  else
    update correo_cola set estado = 'error', ultimo_error = left(coalesce(p_error, 'error desconocido'), 1500),
      proximo_intento_en = now() + (case v.intentos when 1 then interval '2 minutes' when 2 then interval '10 minutes'
                                                     when 3 then interval '30 minutes' else interval '2 hours' end)
     where id = p_id;
  end if;
end $fn$;

-- Reintento manual desde la web (admin/pagos)
create or replace function correo_reintentar(p_id bigint) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then
    raise exception 'sin permiso para reintentar correos';
  end if;
  update correo_cola set estado = 'pendiente', intentos = 0, proximo_intento_en = now()
   where id = p_id and estado in ('error','agotado');
end $fn$;

revoke all on function correo_encolar(text,text,text,text,text,bigint) from public, anon;
revoke all on function correo_tomar(int) from public, anon, authenticated;
revoke all on function correo_resultado(bigint,boolean,text,text) from public, anon, authenticated;
revoke all on function correo_reintentar(bigint) from public, anon;
grant execute on function correo_encolar(text,text,text,text,text,bigint) to authenticated, service_role;
grant execute on function correo_tomar(int) to service_role;
grant execute on function correo_resultado(bigint,boolean,text,text) to service_role;
grant execute on function correo_reintentar(bigint) to authenticated, service_role;
