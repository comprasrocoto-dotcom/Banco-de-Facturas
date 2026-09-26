-- ============================================================
-- CORREO DE AVISOS DE CADA ANALISTA  (26/09/2026)
--   Cada analista puede tener uno o varios correos (hasta 3) donde llegan los avisos del agente (novedades de sus ingresos).
--   El aviso SIEMPRE se envia con copia (Cc) a comprasrocoto@gmail.com: eso lo garantiza el agente (lib/avisos.js), no depende de lo que se escriba aqui.
--   Sin correo de aviso: el aviso va solo a comprasrocoto@gmail.com, como hasta ahora.
--   ADITIVO: 2 columnas nuevas (perfiles.correo_avisos, correo_cola.cc) y funciones nuevas; correo_encolar gana un parametro con valor por defecto (los que ya la llaman siguen igual).
-- ============================================================
alter table perfiles add column if not exists correo_avisos text;
alter table correo_cola add column if not exists cc text;

-- correo_encolar con copia (p_cc). Misma logica de antes; la llave anti-duplicado ahora tambien distingue la copia.
drop function if exists correo_encolar(text, text, text, text, text, bigint, text);
create or replace function correo_encolar(p_para text, p_asunto text, p_cuerpo text, p_cufe text default null, p_pedido text default null, p_orden bigint default null, p_archivo_pdf text default null, p_cc text default null)
returns table (correo_id bigint, duplicado boolean) language plpgsql security definer set search_path = public as $$
declare v_key text; v_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'sin permiso para encolar correos';
  end if;
  v_key := md5(lower(trim(p_para)) || '|' || coalesce(lower(trim(p_cc)), '') || '|' || p_asunto || '|' || p_cuerpo) || '|' || to_char(timezone('America/Bogota', now()), 'YYYY-MM-DD');
  insert into correo_cola (destinatario, cc, asunto, cuerpo, factura_cufe, pedido_numero, orden_id, dedupe_key, archivo_pdf)
  values (trim(p_para), nullif(trim(coalesce(p_cc, '')), ''), p_asunto, p_cuerpo, p_cufe, p_pedido, p_orden, v_key, p_archivo_pdf)
  on conflict (dedupe_key) do nothing
  returning correo_cola.id into v_id;
  if v_id is not null then
    return query select v_id, false; return;
  end if;
  update correo_cola c set estado = 'pendiente', intentos = 0, proximo_intento_en = now(), archivo_pdf = coalesce(p_archivo_pdf, c.archivo_pdf)
   where c.dedupe_key = v_key and c.estado = 'agotado' returning c.id into v_id;
  if v_id is null then select c.id into v_id from correo_cola c where c.dedupe_key = v_key; end if;
  return query select v_id, true;
end $$;
revoke all on function correo_encolar(text, text, text, text, text, bigint, text, text) from public, anon;
grant execute on function correo_encolar(text, text, text, text, text, bigint, text, text) to authenticated, service_role;

-- el alcance que consulta el agente ahora trae tambien el nombre y el correo de avisos
create or replace function alcance_de(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rol text; v_nombre text; v_correo text; v_sedes jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or p_user = auth.uid()) then raise exception 'sin permiso' using errcode = '42501'; end if;
  select case when activo then rol else 'inactivo' end, nombre, correo_avisos into v_rol, v_nombre, v_correo from perfiles where user_id = p_user;
  select coalesce(jsonb_agg(sede_id order by sede_id), '[]'::jsonb) into v_sedes from perfil_sede where user_id = p_user;
  return jsonb_build_object('user_id', p_user, 'nombre', v_nombre, 'correo_avisos', v_correo, 'rol', coalesce(v_rol, 'desconocido'),
                            'restringido', (coalesce(v_rol, '') = 'pagos' and jsonb_array_length(v_sedes) > 0), 'sedes', v_sedes);
end $$;

-- ver / guardar los correos de aviso (solo quien gestiona usuarios)
create or replace function analista_avisos_listar() returns table (user_id uuid, correo text) language plpgsql stable security definer set search_path = public as $$
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para ver los correos de aviso' using errcode = '42501'; end if;
  return query select p.user_id, p.correo_avisos from perfiles p where p.correo_avisos is not null;
end $$;

create or replace function analista_avisos_guardar(p_user uuid, p_correo text) returns text language plpgsql security definer set search_path = public as $$
declare v_rol text; v_lista text[]; v_c text; v_ok text[] := '{}';
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para asignar correos de aviso' using errcode = '42501'; end if;
  select rol into v_rol from perfiles where user_id = p_user;
  if v_rol is null then raise exception 'el usuario no existe' using errcode = '22023'; end if;
  v_lista := regexp_split_to_array(lower(coalesce(p_correo, '')), '[,;[:space:]]+');
  foreach v_c in array v_lista loop
    v_c := btrim(v_c);
    if v_c = '' then continue; end if;
    if v_c !~ '^[^@[:space:],;]+@[^@[:space:],;]+\.[^@[:space:],;]+$' then raise exception 'el correo "%" no es valido', v_c using errcode = '22023'; end if;
    if not (v_c = any (v_ok)) then v_ok := v_ok || v_c; end if;
  end loop;
  if cardinality(v_ok) > 3 then raise exception 'maximo 3 correos por analista' using errcode = '22023'; end if;
  if v_rol <> 'pagos' and cardinality(v_ok) > 0 then raise exception 'solo los analistas tienen correo de aviso' using errcode = '22023'; end if;
  update perfiles set correo_avisos = nullif(array_to_string(v_ok, ', '), '') where user_id = p_user;
  return nullif(array_to_string(v_ok, ', '), '');
end $$;
revoke all on function analista_avisos_listar(), analista_avisos_guardar(uuid, text) from public, anon;
grant execute on function analista_avisos_listar(), analista_avisos_guardar(uuid, text) to authenticated, service_role;
