-- ============================================================
-- SEDES ASIGNADAS A LOS ANALISTAS  (26/09/2026)
--   ANALISTA = sus sedes asignadas + lo que aun no tiene sede.   ADMINISTRADOR = todo.
--   La regla vive en la BASE DE DATOS (politicas RESTRICTIVAS: se suman a las que ya existen, no las cambian) y el agente la aplica en sus consultas
--   (el agente usa la llave de servicio, que se salta las politicas: por eso ademas filtra por el alcance de quien pidio la orden).
--   Un analista SIN sedes asignadas conserva el acceso de antes (transicion: nada se rompe al activar); en cuanto tiene alguna, queda restringido.
--   Analista = usuario de nivel `pagos` (perfil "Analista"). Los usuarios de sede y el administrador no cambian.
-- ============================================================
create table if not exists perfil_sede (
  user_id     uuid not null references perfiles(user_id) on delete cascade,
  sede_id     int  not null references sedes(id) on delete cascade,
  asignado_por uuid,
  creado_en   timestamptz not null default now(),
  primary key (user_id, sede_id)
);
create index if not exists ix_perfil_sede_sede on perfil_sede(sede_id);
alter table perfil_sede enable row level security;
drop policy if exists perfil_sede_ver on perfil_sede;
create policy perfil_sede_ver on perfil_sede for select to authenticated using (user_id = auth.uid() or usuario_puede_gestionar());
-- (sin politicas de escritura: solo las funciones de abajo, que son security definer)

-- Nombre del almacen del ERP -> sede (para filtrar los reportes del ERP del cruce). Un almacen que no esta aqui no se filtra.
create table if not exists sede_almacen (almacen_norm text primary key, sede_id int not null references sedes(id) on delete cascade);
insert into sede_almacen (almacen_norm, sede_id) values
  ('ROCOTO PROVENZA', 1), ('ROCOTO LAURELES', 2), ('ROCOTO AMSTERDAM', 3), ('MALANGA', 4), ('MALANGA DISTRITO VERA', 5),
  ('PLANTA PRODUCCION ROCOTO', 12), ('CASA DE NADIE', 11), ('SIN PAR', 10)
  on conflict do nothing;
alter table sede_almacen enable row level security;
drop policy if exists sede_almacen_ver on sede_almacen;
create policy sede_almacen_ver on sede_almacen for select to authenticated using (true);

-- ---------------------------------------------------------------- alcance
create or replace function analista_sedes() returns int[] language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(sede_id order by sede_id), '{}'::int[]) from perfil_sede where user_id = auth.uid() $$;

create or replace function analista_restringido() returns boolean language sql stable security definer set search_path = public as
$$ select mi_rol() = 'pagos' and exists (select 1 from perfil_sede where user_id = auth.uid()) $$;

-- alcance de un usuario: { rol, restringido, sedes } (el agente lo consulta con la llave de servicio; cada usuario solo el suyo)
create or replace function alcance_de(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rol text; v_sedes jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or p_user = auth.uid()) then raise exception 'sin permiso' using errcode = '42501'; end if;
  select case when activo then rol else 'inactivo' end into v_rol from perfiles where user_id = p_user;
  select coalesce(jsonb_agg(sede_id order by sede_id), '[]'::jsonb) into v_sedes from perfil_sede where user_id = p_user;
  return jsonb_build_object('user_id', p_user, 'rol', coalesce(v_rol, 'desconocido'), 'restringido', (coalesce(v_rol, '') = 'pagos' and jsonb_array_length(v_sedes) > 0), 'sedes', v_sedes);
end $$;
create or replace function mi_alcance() returns jsonb language sql stable security definer set search_path = public as $$ select alcance_de(auth.uid()) $$;

-- "este documento es de OTRA sede" (funciones que se saltan las politicas, para que un analista no lo confunda con "no existe")
create or replace function cufe_de_otra_sede(p text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from facturas f where f.cufe = p and f.sede_id is not null and not (f.sede_id = any (analista_sedes()))) $$;
create or replace function pedido_de_otra_sede(p bigint) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from pedidos x where x.id = p and x.sede_id is not null and not (x.sede_id = any (analista_sedes()))) $$;
create or replace function pedido_num_de_otra_sede(p text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from pedidos x where x.numero = p and x.sede_id is not null and not (x.sede_id = any (analista_sedes()))) $$;
create or replace function almacen_de_otra_sede(p text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from sede_almacen sa where sa.almacen_norm = upper(translate(coalesce(p, ''), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')) and not (sa.sede_id = any (analista_sedes()))) $$;

-- ---------------------------------------------------------------- politicas RESTRICTIVAS (se suman con AND a las existentes; no cambian ninguna)
--   (select ...) se evalua UNA vez por consulta, no por fila.
drop policy if exists rs_facturas on facturas;
create policy rs_facturas on facturas as restrictive for all to authenticated
  using ((select not analista_restringido()) or sede_id is null or sede_id = any ((select analista_sedes())::int[]))
  with check ((select not analista_restringido()) or sede_id is null or sede_id = any ((select analista_sedes())::int[]));
drop policy if exists rs_pedidos on pedidos;
create policy rs_pedidos on pedidos as restrictive for all to authenticated
  using ((select not analista_restringido()) or sede_id is null or sede_id = any ((select analista_sedes())::int[]))
  with check ((select not analista_restringido()) or sede_id is null or sede_id = any ((select analista_sedes())::int[]));
drop policy if exists rs_pedido_lineas on pedido_lineas;
create policy rs_pedido_lineas on pedido_lineas as restrictive for all to authenticated
  using ((select not analista_restringido()) or not pedido_de_otra_sede(pedido_id)) with check ((select not analista_restringido()) or not pedido_de_otra_sede(pedido_id));
drop policy if exists rs_pedido_envio on pedido_envio;
create policy rs_pedido_envio on pedido_envio as restrictive for all to authenticated
  using ((select not analista_restringido()) or not pedido_de_otra_sede(pedido_id)) with check ((select not analista_restringido()) or not pedido_de_otra_sede(pedido_id));
drop policy if exists rs_correo_cola on correo_cola;
create policy rs_correo_cola on correo_cola as restrictive for all to authenticated
  using ((select not analista_restringido()) or not (pedido_num_de_otra_sede(pedido_numero) or cufe_de_otra_sede(factura_cufe)))
  with check ((select not analista_restringido()) or not (pedido_num_de_otra_sede(pedido_numero) or cufe_de_otra_sede(factura_cufe)));
drop policy if exists rs_novedades on novedades;
create policy rs_novedades on novedades as restrictive for all to authenticated
  using ((select not analista_restringido()) or ((sede_id is null or sede_id = any ((select analista_sedes())::int[])) and not cufe_de_otra_sede(cufe)))
  with check ((select not analista_restringido()) or ((sede_id is null or sede_id = any ((select analista_sedes())::int[])) and not cufe_de_otra_sede(cufe)));
drop policy if exists rs_ingreso_documento on ingreso_documento;
create policy rs_ingreso_documento on ingreso_documento as restrictive for select to authenticated using ((select not analista_restringido()) or not pedido_de_otra_sede(pedido_id));
drop policy if exists rs_ordenes on ordenes;
create policy rs_ordenes on ordenes as restrictive for all to authenticated
  using ((select not analista_restringido()) or pedida_por = auth.uid()) with check ((select not analista_restringido()) or pedida_por = auth.uid());
-- cruce DIAN / descargas / PDFs: por la factura del banco a la que pertenece el CUFE (un CUFE que no esta en el banco no tiene sede: se ve)
drop policy if exists rs_conciliacion_resultado on conciliacion_resultado;
create policy rs_conciliacion_resultado on conciliacion_resultado as restrictive for select to authenticated using ((select not analista_restringido()) or not cufe_de_otra_sede(cufe));
drop policy if exists rs_conciliacion_decision on conciliacion_decision;
create policy rs_conciliacion_decision on conciliacion_decision as restrictive for select to authenticated using ((select not analista_restringido()) or not cufe_de_otra_sede(cufe));
drop policy if exists rs_dian_descarga on dian_descarga;
create policy rs_dian_descarga on dian_descarga as restrictive for select to authenticated using ((select not analista_restringido()) or not cufe_de_otra_sede(cufe));
drop policy if exists rs_pdf_proceso on pdf_proceso;
create policy rs_pdf_proceso on pdf_proceso as restrictive for select to authenticated using ((select not analista_restringido()) or not cufe_de_otra_sede(cufe));
drop policy if exists rs_erp_documento on erp_documento;
create policy rs_erp_documento on erp_documento as restrictive for select to authenticated using ((select not analista_restringido()) or not almacen_de_otra_sede(almacen));

-- ---------------------------------------------------------------- asignar sedes (solo quien gestiona usuarios)
create or replace function analista_sedes_listar() returns table (user_id uuid, sede_id int) language plpgsql stable security definer set search_path = public as $$
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para ver las sedes de los analistas' using errcode = '42501'; end if;
  return query select ps.user_id, ps.sede_id from perfil_sede ps order by ps.user_id, ps.sede_id;
end $$;

create or replace function analista_sedes_guardar(p_user uuid, p_sedes int[]) returns int language plpgsql security definer set search_path = public as $$
declare v_rol text; v_n int;
begin
  if not usuario_puede_gestionar() then raise exception 'sin permiso para asignar sedes' using errcode = '42501'; end if;
  select rol into v_rol from perfiles where user_id = p_user;
  if v_rol is null then raise exception 'el usuario no existe' using errcode = '22023'; end if;
  p_sedes := coalesce((select array_agg(distinct x) from unnest(coalesce(p_sedes, '{}'::int[])) x), '{}'::int[]);
  if v_rol <> 'pagos' and cardinality(p_sedes) > 0 then raise exception 'solo los analistas tienen sedes asignadas' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_sedes) s where not exists (select 1 from sedes where id = s)) then raise exception 'alguna sede no existe' using errcode = '22023'; end if;
  delete from perfil_sede where user_id = p_user and not (sede_id = any (p_sedes));
  insert into perfil_sede (user_id, sede_id, asignado_por) select p_user, s, auth.uid() from unnest(p_sedes) s on conflict do nothing;
  select count(*) into v_n from perfil_sede where user_id = p_user; return v_n;
end $$;
revoke all on function analista_sedes_listar(), analista_sedes_guardar(uuid, int[]), alcance_de(uuid) from public, anon;
grant execute on function analista_sedes_listar(), analista_sedes_guardar(uuid, int[]), alcance_de(uuid) to authenticated, service_role;
grant execute on function mi_alcance() to authenticated;

-- ---------------------------------------------------------------- ordenes: una activa POR ANALISTA, y cada agente toma solo lo que le corresponde
drop index if exists ux_ordenes_ingresos_activa;
create unique index ux_ordenes_ingresos_activa on ordenes (tipo, coalesce(pedida_por, '00000000-0000-0000-0000-000000000000'::uuid)) where tipo = 'ingresos' and estado in ('pendiente', 'corriendo');

drop function if exists orden_tomar(text);
create or replace function orden_tomar(p_host text, p_analista uuid default null) returns setof ordenes language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'solo el agente' using errcode = '42501'; end if;
  -- p_analista null = agente sin analista configurado (como antes: toma cualquiera). Con analista: sus ordenes y las de quien no esta restringido (administrador).
  return query update ordenes set estado = 'corriendo', tomada_en = now(), tomada_por = p_host, detener = false, progreso = null
    where id = (select o.id from ordenes o where o.estado = 'pendiente'
                  and (p_analista is null or o.pedida_por is null or o.pedida_por = p_analista or not coalesce((alcance_de(o.pedida_por) ->> 'restringido')::boolean, false))
                order by o.id limit 1 for update skip locked) returning *;
end $$;
revoke all on function orden_tomar(text, uuid) from public, anon; grant execute on function orden_tomar(text, uuid) to service_role;

create or replace function orden_detener(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if not tiene_permiso('ingresos.iniciar') then raise exception 'sin permiso para detener el ingreso' using errcode = '42501'; end if;
  if analista_restringido() and not exists (select 1 from ordenes where id = p_id and pedida_por = auth.uid()) then raise exception 'solo puedes detener tus propias ordenes' using errcode = '42501'; end if;
  update ordenes set detener = true where id = p_id and estado = 'corriendo';
  update ordenes set detener = true, estado = 'terminado', terminada_en = now(), resultado = 'Cancelada por el usuario antes de empezar' where id = p_id and estado = 'pendiente';
end $$;

create or replace function ingreso_reintentar_errores() returns integer language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not tiene_permiso('ingresos.iniciar') then raise exception 'sin permiso para reintentar' using errcode = '42501'; end if;
  update ingreso_documento d set estado = 'PENDIENTE_REINTENTO', etapa = 'reintento pedido por el usuario', actualizado_en = now()
    where d.estado = 'ERROR' and (not analista_restringido() or not pedido_de_otra_sede(d.pedido_id));
  get diagnostics v_n = row_count; return v_n;
end $$;
