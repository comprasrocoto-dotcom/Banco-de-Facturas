-- ============================================================
--  LIMPIEZA: DEJAR EN LA NUBE SOLO EL ULTIMO MES  -  03/11/2026, pedido del usuario:
--  «poder desde el agente dar la orden de borrar informacion de Supabase para liberar espacio, dejar solo un mes»
-- ============================================================
-- Como funciona (nada se pierde: todo queda COPIADO en el PC antes de borrarlo de la nube):
--  1. El administrador, en la web, ve cuanto se liberaria (limpieza_vista_previa) y pide la limpieza (fila en limpieza_solicitud).
--  2. El vigilante del PC la toma, BAJA cada archivo a C:\robot-hiopos\RESPALDO_NUBE\..., comprueba que la copia quedo completa,
--     lo anota en archivo_respaldo y SOLO ENTONCES lo borra de la nube. Los registros viejos (conciliacion, paso a paso de PDFs,
--     avisos ya vistos, correos ya enviados) se guardan en archivos .json en la misma carpeta y luego se borran de la base.
--  3. NUNCA se toca: lo de menos de 30 dias; facturas sin ingresar al ERP o sin enviar a contabilidad; pedidos pendientes;
--     archivos de un correo sin enviar; avisos pendientes. Las filas de facturas y pedidos NO se borran nunca (ocupan poco).
-- Solo AGREGA (2 tablas y 5 funciones). Repetirlo no hace nada.

create table if not exists public.limpieza_solicitud (
  id bigserial primary key,
  creada_en timestamptz not null default now(),
  pedida_por uuid default auth.uid(),
  pedida_por_nombre text,
  dias integer not null default 30 check (dias >= 30),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'corriendo', 'hecho', 'error', 'cancelada')),
  tomada_por text,
  tomada_en timestamptz,
  terminada_en timestamptz,
  avance text,
  carpeta_pc text,
  resumen jsonb
);
-- una sola limpieza activa a la vez
create unique index if not exists limpieza_una_activa on public.limpieza_solicitud ((true)) where estado in ('pendiente', 'corriendo');
alter table public.limpieza_solicitud enable row level security;
drop policy if exists ls_leer on public.limpieza_solicitud;
create policy ls_leer on public.limpieza_solicitud for select to authenticated using ((select mi_rol() as mi_rol) = 'admin');
drop policy if exists ls_pedir on public.limpieza_solicitud;
create policy ls_pedir on public.limpieza_solicitud for insert to authenticated
  with check ((select mi_rol() as mi_rol) = 'admin' and estado = 'pendiente' and tomada_por is null and resumen is null);
drop policy if exists ls_cancelar on public.limpieza_solicitud;
create policy ls_cancelar on public.limpieza_solicitud for update to authenticated
  using ((select mi_rol() as mi_rol) = 'admin' and estado = 'pendiente')
  with check ((select mi_rol() as mi_rol) = 'admin' and estado in ('pendiente', 'cancelada'));

-- que archivo se guardo en el PC y donde (la web lo usa para decir «este archivo esta guardado en el PC» en vez de un error)
create table if not exists public.archivo_respaldo (
  id bigserial primary key,
  ruta text not null,
  bytes bigint,
  categoria text,
  pc text,
  carpeta text,
  solicitud_id bigint references public.limpieza_solicitud(id),
  archivado_en timestamptz not null default now()
);
create index if not exists archivo_respaldo_ruta on public.archivo_respaldo (ruta);
alter table public.archivo_respaldo enable row level security;
drop policy if exists ar_leer on public.archivo_respaldo;
create policy ar_leer on public.archivo_respaldo for select to authenticated using ((select mi_rol() as mi_rol) <> 'inactivo');

-- ---- archivos de la nube que YA se pueden pasar al PC ----
create or replace function public.limpieza_archivos(p_dias integer default 30)
returns table (ruta text, bytes bigint, categoria text)
language sql stable security definer set search_path = public, storage as $$
  with corte as (select now() - make_interval(days => greatest(coalesce(p_dias, 30), 30)) as c),
  listas as (   -- facturas ya ingresadas al ERP Y enviadas a contabilidad
    select f.cufe, f.archivo_pdf, f.archivo_pdf_sellado, f.archivo_recibo, f.archivo_xml from facturas f
    where f.num_ingreso is not null and exists (select 1 from contabilidad_envio e where e.factura_cufe = f.cufe)),
  refs as (
    select archivo_pdf as r, 'Facturas' as k from listas
    union all select archivo_pdf_sellado, 'Facturas' from listas
    union all select archivo_recibo, 'Facturas' from listas
    union all select archivo_xml, 'Facturas' from listas
    union all select ff.foto, 'Fotos de facturas' from factura_foto ff join listas l on l.cufe = ff.factura_cufe
    union all select 'pedidos/' || p.numero || '.pdf', 'PDF de pedidos' from pedidos p where p.estado in ('facturado', 'anulado')
    union all select unnest(cl.archivos), 'Envíos a contabilidad' from contabilidad_lote cl
  )
  select o.name, max(coalesce((o.metadata->>'size')::bigint, 0)), min(r.k)
  from storage.objects o join refs r on r.r = o.name cross join corte
  where o.bucket_id = 'facturas' and o.created_at < corte.c
    -- nunca un archivo que siga en un correo sin enviar
    and not exists (select 1 from correo_cola q where q.archivo_pdf = o.name and q.estado <> 'enviado')
    -- nunca un archivo que tambien use una factura que aun NO esta ingresada y enviada
    and not exists (select 1 from facturas f2
                    where o.name in (f2.archivo_pdf, f2.archivo_pdf_sellado, f2.archivo_recibo, f2.archivo_xml)
                      and not (f2.num_ingreso is not null and exists (select 1 from contabilidad_envio e2 where e2.factura_cufe = f2.cufe)))
    and not exists (select 1 from factura_foto f3 left join facturas f4 on f4.cufe = f3.factura_cufe
                    where f3.foto = o.name
                      and not (f4.num_ingreso is not null and exists (select 1 from contabilidad_envio e3 where e3.factura_cufe = f4.cufe)))
  group by o.name
$$;

-- ---- registros viejos de la base (solo bitacoras: nada de facturas ni pedidos) ----
-- condicion de cada tabla; lista cerrada (no se puede pedir otra tabla)
create or replace function public._limpieza_condicion(p_tabla text, p_dias integer)
returns text language plpgsql immutable as $$
declare c text := format('creado_en < now() - interval %L', greatest(coalesce(p_dias, 30), 30) || ' days');
begin
  return case p_tabla
    when 'conciliacion_resultado' then c
    when 'pdf_proceso' then c
    when 'agente_aviso' then c || ' and estado = ''resuelta'''
    when 'correo_cola' then c || ' and estado = ''enviado'' and not exists (select 1 from pedido_envio pe where pe.correo_cola_id = correo_cola.id)'
    else null end;
end $$;

-- el vigilante lee por bloques lo que va a borrar (para guardarlo en el PC)
create or replace function public.limpieza_registros_leer(p_tabla text, p_dias integer, p_desde_id bigint, p_limite integer default 1000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w text := _limpieza_condicion(p_tabla, p_dias); r jsonb;
begin
  if w is null then raise exception 'tabla no permitida: %', p_tabla; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.id), ''[]''::jsonb) from (select * from %I where %s and id > $1 order by id limit $2) t',
                 p_tabla, w) into r using coalesce(p_desde_id, 0), least(greatest(coalesce(p_limite, 1000), 1), 5000);
  return r;
end $$;

-- y borra SOLO hasta el ultimo id que ya guardo
create or replace function public.limpieza_registros_borrar(p_tabla text, p_dias integer, p_hasta_id bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare w text := _limpieza_condicion(p_tabla, p_dias); n integer;
begin
  if w is null then raise exception 'tabla no permitida: %', p_tabla; end if;
  execute format('delete from %I where %s and id <= $1', p_tabla, w) using coalesce(p_hasta_id, 0);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- lo que ve el administrador antes de pedir la limpieza ----
create or replace function public.limpieza_vista_previa(p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a jsonb; r jsonb := '[]'::jsonb; t text; n bigint;
begin
  if mi_rol() <> 'admin' then raise exception 'Solo el administrador puede ver o pedir la limpieza'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('categoria', x.cat, 'archivos', x.cant, 'bytes', x.tam) order by x.tam desc), '[]'::jsonb) into a
    from (select la.categoria as cat, count(*) as cant, sum(la.bytes) as tam from limpieza_archivos(p_dias) la group by la.categoria) x;
  foreach t in array array['conciliacion_resultado', 'pdf_proceso', 'agente_aviso', 'correo_cola'] loop
    execute format('select count(*) from %I where %s', t, _limpieza_condicion(t, p_dias)) into n;
    r := r || jsonb_build_object('tabla', t, 'filas', n, 'bytes_aprox',
           case when n = 0 then 0 else (pg_total_relation_size(t::regclass)::numeric * n / greatest((select reltuples from pg_class where oid = t::regclass), 1))::bigint end);
  end loop;
  return jsonb_build_object('dias', greatest(coalesce(p_dias, 30), 30), 'archivos', a, 'registros', r);
end $$;

-- permisos: la vista previa solo para usuarios con sesion (y dentro se exige admin); lo demas solo el vigilante (llave de servicio)
revoke all on function public.limpieza_archivos(integer) from public, anon, authenticated;
revoke all on function public._limpieza_condicion(text, integer) from public, anon, authenticated;
revoke all on function public.limpieza_registros_leer(text, integer, bigint, integer) from public, anon, authenticated;
revoke all on function public.limpieza_registros_borrar(text, integer, bigint) from public, anon, authenticated;
revoke all on function public.limpieza_vista_previa(integer) from public, anon;
grant execute on function public.limpieza_vista_previa(integer) to authenticated;
grant execute on function public.limpieza_archivos(integer) to service_role;
grant execute on function public._limpieza_condicion(text, integer) to service_role;
grant execute on function public.limpieza_registros_leer(text, integer, bigint, integer) to service_role;
grant execute on function public.limpieza_registros_borrar(text, integer, bigint) to service_role;
grant select, insert, update on public.limpieza_solicitud to authenticated;
grant usage, select on sequence public.limpieza_solicitud_id_seq to authenticated;
grant select on public.archivo_respaldo to authenticated;
