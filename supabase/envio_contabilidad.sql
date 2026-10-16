-- ============================================================
--  ENVIO A CONTABILIDAD (16/10/2026, pedido del usuario)
-- ============================================================
-- Que ningun documento con el proceso terminado (ingresado al ERP y sellado, o nota credito ingresada) se quede sin enviar
-- a contabilidad, y que ninguno se envie dos veces (pagos dobles). Antes se enviaba por rango de FECHA DE INGRESO: lo que se
-- sellaba despues de su dia de ingreso no salia en ninguna descarga.
--   contabilidad_lote:  cada envio (quien, cuando, cuantos). Se puede ANULAR (deshacer) sin borrar el lote.
--   contabilidad_envio: un documento -> el lote en que se envio (uno solo: no se repite).
-- Solo aditivo: dos tablas nuevas y funciones nuevas. No toca facturas ni la vista facturas_busqueda.
create table if not exists contabilidad_lote (
  id          bigserial primary key,
  creado_en   timestamptz not null default now(),
  creado_por  text,
  usuario     uuid default auth.uid(),
  cantidad    integer not null default 0,
  nota        text,
  anulado     boolean not null default false,
  anulado_en  timestamptz,
  anulado_por text
);
create table if not exists contabilidad_envio (
  factura_cufe text primary key references facturas(cufe) on delete cascade,
  lote_id      bigint not null references contabilidad_lote(id),
  enviada_en   timestamptz not null default now()
);
create index if not exists contabilidad_envio_lote on contabilidad_envio (lote_id);

alter table contabilidad_lote enable row level security;
alter table contabilidad_envio enable row level security;
drop policy if exists cl_leer on contabilidad_lote;
create policy cl_leer on contabilidad_lote for select to authenticated using (mi_rol() = any (array['admin', 'pagos']));
drop policy if exists ce_leer on contabilidad_envio;
create policy ce_leer on contabilidad_envio for select to authenticated using (mi_rol() = any (array['admin', 'pagos']));
revoke all on contabilidad_lote, contabilidad_envio from anon;
grant select on contabilidad_lote, contabilidad_envio to authenticated;

-- marca como ENVIADOS los documentos de un envio (los que ya estaban enviados no se repiten) -> { lote, marcadas, ya_estaban }
create or replace function contabilidad_marcar(p_cufes text[], p_nota text default null, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lote bigint; v_n integer; v_total integer := coalesce(cardinality(p_cufes), 0);
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Solo admin o pagos marcan envios a contabilidad.' using errcode = '42501';
  end if;
  if v_total = 0 then raise exception 'No hay documentos para marcar.' using errcode = '22023'; end if;
  insert into contabilidad_lote (creado_por, nota) values (nullif(btrim(coalesce(p_usuario, '')), ''), nullif(btrim(coalesce(p_nota, '')), ''))
  returning id into v_lote;
  insert into contabilidad_envio (factura_cufe, lote_id)
  select distinct c, v_lote from unnest(p_cufes) as c where exists (select 1 from facturas f where f.cufe = c)
  on conflict (factura_cufe) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Esos documentos ya estaban enviados a contabilidad: no se marco nada.' using errcode = '22023'; end if;
  update contabilidad_lote set cantidad = v_n where id = v_lote;
  insert into historial (accion, detalle) values ('envio a contabilidad', 'lote ' || v_lote || ': ' || v_n || ' documento(s)' || case when v_total > v_n then ' (' || (v_total - v_n) || ' ya estaban enviados)' else '' end);
  return jsonb_build_object('lote', v_lote, 'marcadas', v_n, 'ya_estaban', v_total - v_n);
end $$;
grant execute on function contabilidad_marcar(text[], text, text) to authenticated;

-- DESHACER un lote (se marco por error / no se envio): sus documentos vuelven a "por enviar". El lote queda anulado (no se borra).
create or replace function contabilidad_anular_lote(p_lote bigint, p_usuario text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then
    raise exception 'Solo un administrador puede deshacer un envio.' using errcode = '42501';
  end if;
  delete from contabilidad_envio where lote_id = p_lote;
  get diagnostics v_n = row_count;
  update contabilidad_lote set anulado = true, anulado_en = now(), anulado_por = nullif(btrim(coalesce(p_usuario, '')), '') where id = p_lote;
  insert into historial (accion, detalle) values ('envio a contabilidad deshecho', 'lote ' || p_lote || ': ' || v_n || ' documento(s) vuelven a por enviar');
  return v_n;
end $$;
grant execute on function contabilidad_anular_lote(bigint, text) to authenticated;
