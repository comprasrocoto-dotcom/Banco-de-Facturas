-- ============================================================
--  AVISO SI ALGUIEN SIN PERMISO PIDE LOS REPORTES DEL ADMINISTRADOR  -  03/11/2026, pedido del usuario:
--  «¿me puedes mandar alerta si alguien lo quiere pedir y quién?»
-- ============================================================
-- «Rendimiento del agente» (reporte_ingresos) y «Liberar espacio en la nube» (limpieza_vista_previa) son solo del administrador.
-- Si alguien que NO es administrador los pide (por ejemplo llamando la funcion por fuera de la pantalla), ahora:
--   1. queda anotado en acceso_negado (quién, su rol, qué pidió y cuándo) y en el historial,
--   2. le llega un correo a cada administrador activo (lo envía el vigilante, como los demás correos), máximo uno por persona
--      y por hora para no llenar el buzón,
--   3. a esa persona no se le entrega nada.
-- (Antes la base solo lo rechazaba sin dejar rastro.) Agrega 1 tabla y 1 funcion; las dos funciones del reporte cambian SOLO
-- en lo que hacen cuando quien pide no es administrador. Repetirlo no hace nada.

create table if not exists public.acceso_negado (
  id bigserial primary key,
  creado_en timestamptz not null default now(),
  user_id uuid,
  nombre text,
  rol text,
  que text not null
);
alter table public.acceso_negado enable row level security;
drop policy if exists an_leer on public.acceso_negado;
create policy an_leer on public.acceso_negado for select to authenticated using ((select mi_rol() as mi_rol) = 'admin');
grant select on public.acceso_negado to authenticated;

create or replace function public.aviso_sin_permiso(p_que text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid(); v_nombre text; v_rol text; v_correo text; a record; v_hora text;
begin
  select pf.nombre, pf.rol into v_nombre, v_rol from perfiles pf where pf.user_id = v_uid;
  select u.email into v_correo from auth.users u where u.id = v_uid;
  v_nombre := coalesce(v_nombre, v_correo, 'usuario desconocido');
  insert into acceso_negado (user_id, nombre, rol, que) values (v_uid, v_nombre, coalesce(v_rol, 'sin perfil'), p_que);
  insert into historial (accion, detalle, usuario) values ('intento sin permiso', p_que || ' · ' || v_nombre || ' (' || coalesce(v_rol, 'sin perfil') || ')', v_uid);
  v_hora := to_char(timezone('America/Bogota', now()), 'YYYY-MM-DD HH24');
  for a in select u.email from perfiles pf join auth.users u on u.id = pf.user_id where pf.rol = 'admin' and pf.activo and u.email is not null loop
    insert into correo_cola (destinatario, asunto, cuerpo, dedupe_key)
    values (a.email, '⚠️ Banco de Facturas: intento de ver «' || p_que || '» sin permiso',
      'Hola,' || chr(10) || chr(10) || 'Alguien que no es administrador intentó ver «' || p_que || '».' || chr(10) || chr(10) ||
      'Quién: ' || v_nombre || coalesce(' (' || v_correo || ')', '') || chr(10) || 'Rol: ' || coalesce(v_rol, 'sin perfil') || chr(10) ||
      'Cuándo: ' || to_char(timezone('America/Bogota', now()), 'DD/MM/YYYY HH24:MI') || chr(10) || chr(10) ||
      'No se le entregó ningún dato. Queda anotado en el historial («intento sin permiso»).',
      'acceso_negado|' || md5(lower(a.email) || '|' || coalesce(v_uid::text, '-') || '|' || p_que) || '|' || v_hora)
    on conflict (dedupe_key) do nothing;
  end loop;
end $$;
revoke all on function public.aviso_sin_permiso(text) from public, anon, authenticated;

-- reporte_ingresos: igual que antes, pero sin permiso -> aviso y nada
create or replace function public.reporte_ingresos(p_desde date, p_hasta date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r jsonb;
begin
  if mi_rol() <> 'admin' then perform aviso_sin_permiso('Rendimiento del agente'); return null; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Rango de fechas no valido.' using errcode = '22023'; end if;
  if p_hasta - p_desde > 370 then raise exception 'El rango puede ser de hasta un año.' using errcode = '22023'; end if;
  with base as (
    select p.id, p.numero, p.estado, p.fecha, p.sede_id, p.sede_texto, p.proveedor_texto, p.marca_id, p.factura_cufe,
           p.numero_factura, p.factura_amarrada_en,
           i.estado as ing_estado, i.etapa, i.error_etapa, i.error, i.intentos, i.iniciado_en, i.terminado_en, i.actualizado_en, i.orden_id,
           f.documento, f.num_ingreso, f.fecha_ingreso, f.total
    from pedidos p
    left join ingreso_documento i on i.pedido_id = p.id
    left join facturas f on f.cufe = p.factura_cufe
    where p.factura_cufe is not null and p.estado <> 'anulado'
  ), clas as (
    select b.*,
      case when b.ing_estado = 'COMPLETADO' then 'AGENTE'
           when b.estado = 'facturado' and b.ing_estado is not null then 'ANALISTA_TRAS_FALLO'
           when b.estado = 'facturado' then 'ANALISTA_DIRECTO'
           else 'PENDIENTE' end as como,
      coalesce(case when b.ing_estado = 'COMPLETADO' then (b.terminado_en at time zone 'America/Bogota')::date end,
               b.fecha_ingreso,
               (b.actualizado_en at time zone 'America/Bogota')::date,
               (b.factura_amarrada_en at time zone 'America/Bogota')::date,
               b.fecha) as dia
    from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'pedido', c.numero, 'fecha_pedido', c.fecha, 'dia', c.dia, 'como', c.como,
      'marca', m.nombre, 'sede', coalesce(s.nombre, c.sede_texto), 'proveedor', c.proveedor_texto,
      'factura', coalesce(c.documento, c.numero_factura), 'total', c.total, 'num_ingreso', c.num_ingreso,
      'intentos', c.intentos, 'etapa_error', c.error_etapa, 'error', left(c.error, 400), 'estado_cola', c.ing_estado,
      'analista', (select string_agg(pf.nombre, ', ' order by pf.nombre) from perfil_sede ps join perfiles pf on pf.user_id = ps.user_id
                   where ps.sede_id = c.sede_id and pf.activo),
      'lanzo', (select pf.nombre from ordenes o join perfiles pf on pf.user_id = o.pedida_por where o.id = c.orden_id),
      'anoto', (select pf.nombre from historial h join perfiles pf on pf.user_id::text = h.usuario::text
                where h.cufe = c.factura_cufe and h.accion like 'numero de ingreso ERP%' order by h.id desc limit 1)
    ) order by c.dia, c.numero), '[]'::jsonb) into r
  from clas c
  left join sedes s on s.id = c.sede_id
  left join marcas m on m.id = c.marca_id
  where c.dia between p_desde and p_hasta;
  return r;
end $$;

-- limpieza_vista_previa: igual que antes, pero sin permiso -> aviso y nada
create or replace function public.limpieza_vista_previa(p_dias integer default 30)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a jsonb; r jsonb := '[]'::jsonb; t text; n bigint;
begin
  if mi_rol() <> 'admin' then perform aviso_sin_permiso('Liberar espacio en la nube'); return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('categoria', x.cat, 'archivos', x.cant, 'bytes', x.tam) order by x.tam desc), '[]'::jsonb) into a
    from (select la.categoria as cat, count(*) as cant, sum(la.bytes) as tam from limpieza_archivos(p_dias) la group by la.categoria) x;
  foreach t in array array['conciliacion_resultado', 'pdf_proceso', 'agente_aviso', 'correo_cola'] loop
    execute format('select count(*) from %I where %s', t, _limpieza_condicion(t, p_dias)) into n;
    r := r || jsonb_build_object('tabla', t, 'filas', n, 'bytes_aprox',
           case when n = 0 then 0 else (pg_total_relation_size(t::regclass)::numeric * n / greatest((select reltuples from pg_class where oid = t::regclass), 1))::bigint end);
  end loop;
  return jsonb_build_object('dias', greatest(coalesce(p_dias, 30), 30), 'archivos', a, 'registros', r);
end $$;
