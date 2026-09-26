-- ============================================================
--  LAS SEDES TAMBIEN ENVIAN SUS PEDIDOS AL PROVEEDOR  -  26/09/2026
--  Antes el boton "ENVIAR AL PROVEEDOR" era solo de admin/pagos porque encolar y reintentar correos (correo_encolar / correo_reintentar) y leer la cola son de admin/pagos.
--  Aqui se le da a la sede lo minimo para SUS pedidos, sin abrirle esas funciones:
--   - permiso `pedidos.enviar_proveedor` al perfil de origen "Sede"
--   - pedido_correo_encolar(): encola el correo del pedido, SOLO si el pedido es de su sede y SOLO al correo registrado del proveedor (no se puede usar para escribirle a otra persona)
--   - pedido_correo_estados(): estado de los correos de ese pedido (la sede no puede leer correo_cola)
--   - pedido_correo_reintentar(): reintenta un correo fallido de ese pedido
--  SOLO AGREGA: no cambia correo_encolar, correo_reintentar ni ninguna politica existente.
-- ============================================================
insert into perfil_permiso (perfil_id, permiso)
select id, 'pedidos.enviar_proveedor' from perfil_acceso where clave = 'sede'
on conflict do nothing;

-- ¿Puede quien llama operar (enviar) este pedido? Mismo criterio que pedido_envio_registrar + el permiso del perfil
create or replace function pedido_puede_operar(p_pedido_id bigint) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select (mi_rol() = any (array['admin', 'pagos']) or (mi_rol() = 'sede' and (p.sede_id = mi_sede() or p.marca_id = mi_marca())))
                     from pedidos p where p.id = p_pedido_id), false)
     and tiene_permiso('pedidos.enviar_proveedor')
$fn$;

create or replace function pedido_correo_encolar(p_pedido_id bigint, p_para text, p_asunto text, p_cuerpo text, p_archivo_pdf text default null)
returns table (correo_id bigint, duplicado boolean)
language plpgsql security definer set search_path = public as $fn$
declare v_num text; v_correos text[]; v_dest text[]; v_key text; v_id bigint;
begin
  if not pedido_puede_operar(p_pedido_id) then raise exception 'sin permiso para enviar este pedido' using errcode = '42501'; end if;
  if length(coalesce(p_asunto, '')) not between 1 and 300 or length(coalesce(p_cuerpo, '')) not between 1 and 30000 then raise exception 'asunto o cuerpo invalido' using errcode = '22023'; end if;
  if p_archivo_pdf is not null and p_archivo_pdf !~ '^pedidos/[A-Za-z0-9._-]+\.pdf$' then raise exception 'ruta del pdf invalida' using errcode = '22023'; end if;
  select p.numero, (select array_agg(lower(x)) from unnest(regexp_split_to_array(coalesce(pr.correo, ''), '[;,[:space:]]+')) x where x <> '')
    into v_num, v_correos from pedidos p left join proveedores pr on pr.id = p.proveedor_id where p.id = p_pedido_id;
  v_dest := (select array_agg(lower(btrim(x))) from unnest(regexp_split_to_array(coalesce(p_para, ''), '[;,[:space:]]+')) x where btrim(x) <> '');
  -- el destinatario es el correo REGISTRADO del proveedor de ese pedido (todos los destinatarios), nunca otra direccion
  if v_dest is null or v_correos is null or exists (select 1 from unnest(v_dest) d where d <> all (v_correos)) then raise exception 'el correo no es el registrado del proveedor de este pedido' using errcode = '22023'; end if;
  v_key := md5(lower(trim(p_para)) || '|' || p_asunto || '|' || p_cuerpo) || '|' || to_char(timezone('America/Bogota', now()), 'YYYY-MM-DD');
  insert into correo_cola (destinatario, asunto, cuerpo, pedido_numero, dedupe_key, archivo_pdf)
  values (trim(p_para), p_asunto, p_cuerpo, v_num, v_key, p_archivo_pdf)
  on conflict (dedupe_key) do nothing returning correo_cola.id into v_id;
  if v_id is not null then return query select v_id, false; return; end if;
  update correo_cola c set estado = 'pendiente', intentos = 0, proximo_intento_en = now(), archivo_pdf = coalesce(p_archivo_pdf, c.archivo_pdf)
   where c.dedupe_key = v_key and c.estado = 'agotado' returning c.id into v_id;
  if v_id is null then select c.id into v_id from correo_cola c where c.dedupe_key = v_key; end if;
  return query select v_id, true;
end
$fn$;

create or replace function pedido_correo_estados(p_pedido_id bigint)
returns table (id bigint, estado text, ultimo_error text, enviado_en timestamptz, intentos int)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not exists (select 1 from pedidos p where p.id = p_pedido_id and (mi_rol() = any (array['admin', 'pagos']) or (mi_rol() = 'sede' and (p.sede_id = mi_sede() or p.marca_id = mi_marca())))) then
    raise exception 'sin permiso para ver los envios de este pedido' using errcode = '42501';
  end if;
  return query select c.id, c.estado, c.ultimo_error, c.enviado_en, c.intentos from correo_cola c
   where c.id in (select e.correo_cola_id from pedido_envio e where e.pedido_id = p_pedido_id and e.correo_cola_id is not null);
end
$fn$;

create or replace function pedido_correo_reintentar(p_cola_id bigint) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_ped bigint;
begin
  select e.pedido_id into v_ped from pedido_envio e where e.correo_cola_id = p_cola_id order by e.id desc limit 1;
  if v_ped is null or not pedido_puede_operar(v_ped) then raise exception 'sin permiso para reintentar este correo' using errcode = '42501'; end if;
  update correo_cola set estado = 'pendiente', intentos = 0, proximo_intento_en = now() where id = p_cola_id and estado in ('error', 'agotado');
end
$fn$;

revoke all on function pedido_puede_operar(bigint), pedido_correo_encolar(bigint, text, text, text, text), pedido_correo_estados(bigint), pedido_correo_reintentar(bigint) from public, anon;
grant execute on function pedido_puede_operar(bigint), pedido_correo_encolar(bigint, text, text, text, text), pedido_correo_estados(bigint), pedido_correo_reintentar(bigint) to authenticated;
