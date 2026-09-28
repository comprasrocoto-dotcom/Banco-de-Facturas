-- ============================================================
--  agente_aviso.sql  -  NOVEDADES DEL AGENTE QUE HOY SOLO IBAN POR CORREO  (28/09/2026)   ADITIVO: no toca nada existente
--  Cuando un pedido no tiene factura amarrada todavia, o el agente tropieza con algo que no es "unidad sin decidir" ni "nombre sin decidir"
--  (esas ya tienen su propia cola: unidad_revision / producto_revision), el aviso solo llegaba por correo. Aqui queda tambien en la web,
--  para verlo en Admin > Agente > "Avisos del agente" y decidir si hay que "ensenarle" algo (una regla, un dato) o solo darlo por visto.
--  Ve con el mismo permiso que ya abre esa pestana (admin.agente): quien lo tenga (hoy solo Administrador; el admin puede dárselo a un Analista).
-- ============================================================
create table if not exists agente_aviso (
  id            bigint generated always as identity primary key,
  creado_en     timestamptz not null default now(),
  motivo        text not null,
  detalle       text,
  factura_cufe  text,
  pedido_numero text,
  orden_id      bigint references ordenes(id) on delete set null,
  estado        text not null default 'pendiente' check (estado in ('pendiente','resuelta')),
  resuelta_en   timestamptz,
  resuelta_por  text
);
create index if not exists agente_aviso_pendientes_idx on agente_aviso (estado, creado_en desc);

alter table agente_aviso enable row level security;
drop policy if exists agente_aviso_leer on agente_aviso;
create policy agente_aviso_leer on agente_aviso for select to authenticated using (tiene_permiso('admin.agente'));
revoke all on agente_aviso from anon, authenticated;   -- el agente escribe con la llave de servicio (no pasa por RLS); desde la web solo se lee y solo se resuelve por la funcion de abajo
grant select on agente_aviso to authenticated;

-- Marca uno o varios avisos como resueltos (no borra nada; sigue en la base para consultar despues)
create or replace function agente_aviso_resolver(p_ids bigint[], p_usuario text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if not tiene_permiso('admin.agente') then raise exception 'sin permiso para resolver avisos del agente' using errcode = '42501'; end if;
  update agente_aviso set estado = 'resuelta', resuelta_en = now(), resuelta_por = coalesce(nullif(btrim(p_usuario), ''), 'admin')
   where id = any (coalesce(p_ids, '{}')) and estado = 'pendiente';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function agente_aviso_resolver(bigint[], text) from public;
grant execute on function agente_aviso_resolver(bigint[], text) to authenticated;
