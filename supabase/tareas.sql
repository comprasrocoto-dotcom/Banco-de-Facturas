-- ============================================================
--  TAREAS PARA LOS ANALISTAS (16/10/2026, pedido del usuario)
-- ============================================================
-- El administrador asigna tareas (inventarios ciclicos, visitas, capacitaciones u otras) con fecha de cumplimiento a uno o
-- varios analistas; cada analista ve las suyas, cambia su estado y sube evidencias (fotos/PDF en el bucket «facturas», carpeta
-- tareas/). En la evaluacion cuenta «Tareas a tiempo» (terminada a mas tardar en su fecha). Al asignar, le llega un correo.
-- Solo aditivo: dos tablas nuevas y funciones nuevas.
create table if not exists tarea (
  id             bigserial primary key,
  creado_en      timestamptz not null default now(),
  creado_por     uuid default auth.uid(),
  asignada_a     uuid not null references perfiles(user_id) on delete cascade,
  tipo           text not null default 'otra' check (tipo in ('inventario', 'visita', 'capacitacion', 'otra')),
  titulo         text not null check (length(btrim(titulo)) > 0),
  descripcion    text,
  sede_id        int references sedes(id) on delete set null,
  fecha_limite   date not null,
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'terminada', 'cancelada')),
  terminada_en   timestamptz,
  actualizado_en timestamptz not null default now()
);
create index if not exists tarea_asignada_idx on tarea (asignada_a, fecha_limite);
-- historial de cada tarea: cambios de estado, comentarios y evidencias
create table if not exists tarea_evento (
  id             bigserial primary key,
  tarea_id       bigint not null references tarea(id) on delete cascade,
  en             timestamptz not null default now(),
  usuario        uuid default auth.uid(),
  usuario_nombre text,
  estado         text,
  comentario     text,
  archivo        text,
  archivo_nombre text
);
create index if not exists tarea_evento_tarea_idx on tarea_evento (tarea_id, en);

alter table tarea enable row level security;
alter table tarea_evento enable row level security;
drop policy if exists tarea_leer on tarea;
create policy tarea_leer on tarea for select to authenticated using (mi_rol() = 'admin' or asignada_a = auth.uid());
drop policy if exists tarea_evento_leer on tarea_evento;
create policy tarea_evento_leer on tarea_evento for select to authenticated
  using (exists (select 1 from tarea t where t.id = tarea_evento.tarea_id and (mi_rol() = 'admin' or t.asignada_a = auth.uid())));
revoke all on tarea, tarea_evento from anon;
grant select on tarea, tarea_evento to authenticated;

-- asignar una tarea a una o varias personas (solo administrador) -> cuantas se crearon. Le avisa a cada una por correo.
create or replace function tarea_crear(p_asignados uuid[], p_tipo text, p_titulo text, p_descripcion text, p_sede int, p_fecha_limite date, p_usuario text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare u uuid; v_id bigint; n int := 0; v_dest text; v_nombre text;
        v_tipo text := case p_tipo when 'inventario' then '📦 Inventario cíclico' when 'visita' then '🚗 Visita' when 'capacitacion' then '🎓 Capacitación' else '📝 Tarea' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador asigna tareas.' using errcode = '42501'; end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'Escribe el título de la tarea.' using errcode = '22023'; end if;
  if p_fecha_limite is null then raise exception 'Elige la fecha de cumplimiento.' using errcode = '22023'; end if;
  if coalesce(cardinality(p_asignados), 0) = 0 then raise exception 'Elige a quién se le asigna.' using errcode = '22023'; end if;
  foreach u in array p_asignados loop
    select nombre into v_nombre from perfiles where user_id = u and rol in ('admin', 'pagos') and coalesce(activo, true);
    if v_nombre is null then continue; end if;
    insert into tarea (asignada_a, tipo, titulo, descripcion, sede_id, fecha_limite)
    values (u, coalesce(nullif(p_tipo, ''), 'otra'), btrim(p_titulo), nullif(btrim(coalesce(p_descripcion, '')), ''), p_sede, p_fecha_limite)
    returning id into v_id;
    insert into tarea_evento (tarea_id, usuario_nombre, estado, comentario) values (v_id, nullif(btrim(coalesce(p_usuario, '')), ''), 'pendiente', 'Tarea asignada');
    n := n + 1;
    select coalesce(nullif(btrim(p.correo_avisos), ''), au.email::text) into v_dest from perfiles p left join auth.users au on au.id = p.user_id where p.user_id = u;
    if v_dest is not null then
      perform correo_encolar(v_dest,
        '📝 Banco de Facturas · ' || v_nombre || ' · nueva tarea: ' || btrim(p_titulo) || ' · vence ' || to_char(p_fecha_limite, 'DD/MM'),
        '👋 Hola ' || v_nombre || E',\n\nTe asignaron una tarea en el Banco de Facturas:\n\n' || v_tipo || ': ' || btrim(p_titulo) ||
        coalesce(E'\n🏪 Sede: ' || (select nombre from sedes where id = p_sede), '') ||
        E'\n📅 Fecha de cumplimiento: ' || to_char(p_fecha_limite, 'DD/MM/YYYY') ||
        coalesce(E'\n\n' || nullif(btrim(coalesce(p_descripcion, '')), ''), '') ||
        E'\n\n👉 Entra a la web, menú «📝 Tareas»: cambia el estado cuando la empieces y cuando la termines, y sube las evidencias (fotos o PDF).' ||
        E'\n\n🤖 Correo automático del Banco de Facturas.',
        null, null, null, null, 'comprasrocoto@gmail.com');
    end if;
  end loop;
  if n = 0 then raise exception 'Ninguna de las personas elegidas puede recibir tareas.' using errcode = '22023'; end if;
  return n;
end $$;

-- cambiar el estado (la persona asignada o el administrador; cancelar solo el administrador) con un comentario opcional
create or replace function tarea_estado(p_id bigint, p_estado text, p_comentario text default null, p_usuario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tarea%rowtype;
begin
  select * into t from tarea where id = p_id;
  if not found then raise exception 'Esa tarea no existe.' using errcode = '22023'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' and t.asignada_a is distinct from auth.uid() then raise exception 'Esa tarea no es tuya.' using errcode = '42501'; end if;
  if p_estado not in ('pendiente', 'en_proceso', 'terminada', 'cancelada') then raise exception 'Estado no válido.' using errcode = '22023'; end if;
  if p_estado = 'cancelada' and coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo el administrador cancela una tarea.' using errcode = '42501'; end if;
  update tarea set estado = p_estado, actualizado_en = now(),
         terminada_en = case when p_estado = 'terminada' then coalesce(case when t.estado = 'terminada' then t.terminada_en end, now()) else null end
   where id = p_id;
  insert into tarea_evento (tarea_id, usuario_nombre, estado, comentario) values (p_id, nullif(btrim(coalesce(p_usuario, '')), ''), p_estado, nullif(btrim(coalesce(p_comentario, '')), ''));
end $$;

-- comentario y/o evidencia (archivo ya subido al bucket «facturas», carpeta tareas/<id>/)
create or replace function tarea_evidencia(p_id bigint, p_archivo text, p_nombre text, p_comentario text default null, p_usuario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tarea%rowtype;
begin
  select * into t from tarea where id = p_id;
  if not found then raise exception 'Esa tarea no existe.' using errcode = '22023'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' and t.asignada_a is distinct from auth.uid() then raise exception 'Esa tarea no es tuya.' using errcode = '42501'; end if;
  if coalesce(btrim(p_archivo), '') = '' and coalesce(btrim(p_comentario), '') = '' then raise exception 'Escribe un comentario o adjunta una evidencia.' using errcode = '22023'; end if;
  if coalesce(btrim(p_archivo), '') <> '' and p_archivo not like 'tareas/' || p_id || '/%' then raise exception 'La evidencia no corresponde a esta tarea.' using errcode = '22023'; end if;
  insert into tarea_evento (tarea_id, usuario_nombre, comentario, archivo, archivo_nombre)
  values (p_id, nullif(btrim(coalesce(p_usuario, '')), ''), nullif(btrim(coalesce(p_comentario, '')), ''), nullif(btrim(coalesce(p_archivo, '')), ''), nullif(btrim(coalesce(p_nombre, '')), ''));
  update tarea set actualizado_en = now() where id = p_id;
end $$;

-- editar (solo administrador)
create or replace function tarea_editar(p_id bigint, p_tipo text, p_titulo text, p_descripcion text, p_sede int, p_fecha_limite date, p_usuario text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador edita tareas.' using errcode = '42501'; end if;
  if coalesce(btrim(p_titulo), '') = '' or p_fecha_limite is null then raise exception 'Falta el título o la fecha.' using errcode = '22023'; end if;
  update tarea set tipo = coalesce(nullif(p_tipo, ''), tipo), titulo = btrim(p_titulo), descripcion = nullif(btrim(coalesce(p_descripcion, '')), ''), sede_id = p_sede,
         fecha_limite = p_fecha_limite, actualizado_en = now() where id = p_id;
  insert into tarea_evento (tarea_id, usuario_nombre, comentario) values (p_id, nullif(btrim(coalesce(p_usuario, '')), ''), 'Tarea editada (vence ' || to_char(p_fecha_limite, 'DD/MM/YYYY') || ')');
end $$;

revoke all on function tarea_crear(uuid[], text, text, text, int, date, text), tarea_estado(bigint, text, text, text), tarea_evidencia(bigint, text, text, text, text), tarea_editar(bigint, text, text, text, int, date, text) from public, anon;
grant execute on function tarea_crear(uuid[], text, text, text, int, date, text), tarea_estado(bigint, text, text, text), tarea_evidencia(bigint, text, text, text, text), tarea_editar(bigint, text, text, text, int, date, text) to authenticated, service_role;
