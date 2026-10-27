-- ============================================================
--  ENVIO A CONTABILIDAD POR CORREO DESDE EL BANCO (27/10/2026, pedido del usuario)
-- ============================================================
-- «Para mayor trazabilidad enviar tanto el Excel como el ZIP desde el banco, directo al correo». Cada lote guarda a que correo
-- se mando, la referencia del envio (ENV-AAAAMMDD-HHMM), los correos de la cola (correo_cola) y los archivos guardados en el
-- bucket «facturas» (carpeta contabilidad/<referencia>/). Un lote se puede volver a mandar: se agregan los correos nuevos.
-- SOLO AGREGA: 4 columnas en contabilidad_lote y una funcion. No cambia contabilidad_marcar ni nada de lo que ya funciona.
alter table contabilidad_lote add column if not exists correo_para text;
alter table contabilidad_lote add column if not exists correo_ids  bigint[];
alter table contabilidad_lote add column if not exists archivos    text[];
alter table contabilidad_lote add column if not exists referencia  text;

create or replace function contabilidad_lote_correo(p_lote bigint, p_para text, p_ids bigint[], p_archivos text[], p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin', 'pagos') then
    raise exception 'Solo admin o pagos envian a contabilidad.' using errcode = '42501';
  end if;
  update contabilidad_lote
     set correo_para = nullif(btrim(coalesce(p_para, '')), ''),
         correo_ids  = coalesce(correo_ids, '{}') || coalesce(p_ids, '{}'),
         archivos    = coalesce(archivos, '{}') || coalesce(p_archivos, '{}'),
         referencia  = case when referencia is null or referencia = p_ref then p_ref else referencia || ', ' || p_ref end
   where id = p_lote;
  if not found then raise exception 'No existe el lote %', p_lote using errcode = '22023'; end if;
  insert into historial (accion, detalle)
  values ('envio a contabilidad por correo', 'lote ' || p_lote || ' · ' || coalesce(p_ref, '') || ' · a ' || coalesce(p_para, '') || ' · ' || coalesce(cardinality(p_ids), 0) || ' correo(s)');
end $$;
revoke all on function contabilidad_lote_correo(bigint, text, bigint[], text[], text) from public, anon;
grant execute on function contabilidad_lote_correo(bigint, text, bigint[], text[], text) to authenticated;
