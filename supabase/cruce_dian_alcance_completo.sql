-- ============================================================
--  cruce_dian_alcance_completo.sql  -  El Cruce DIAN necesita ver TODA la marca, no solo las sedes del analista (29/09/2026)   ADITIVO
--  El Excel de la DIAN es por MARCA (empresa), no por sede. Al comparar "que hay en la DIAN" contra "que ya esta en el banco/pedidos/ERP"
--  (js/conciliacion-ui.js: concCargarFuentes, concFuentesFrescas, concRefrescarCarga), la web leia facturas/pedidos/erp_documento/
--  conciliacion_decision con la sesion del analista, sujeta a las politicas RESTRICTIVAS por sede de analista_sedes.sql (rs_facturas,
--  rs_pedidos, rs_erp_documento, rs_conciliacion_decision). Un analista restringido (ej. Deiby Leal: sedes de 123 wok y Rocoto) no veia
--  en esas consultas lo YA cargado por OTRA sede de la MISMA marca -> el cruce no lo encontraba y lo mostraba como "pendiente" (falso
--  positivo), aunque ya estuviera en el sistema; el mismo hueco podia dejar re-encolar (duplicar) un documento en la re-verificacion
--  de "Iniciar carga" y en el refresco de progreso.
--
--  Estas 4 funciones devuelven las MISMAS columnas que ya se pedian directo (nada nuevo ni mas sensible), sin el filtro de sede:
--  cualquier admin o analista (rol 'pagos') puede llamarlas. Sin argumentos devuelven TODA la tabla (como antes hacia concCargarFuentes);
--  con argumentos buscan un documento puntual (como antes hacia concFuentesFrescas/concRefrescarCarga, con varias consultas .from()
--  separadas). NO tocan ninguna politica RLS existente (rs_facturas etc. siguen igual para el resto de la app).
-- ============================================================

create or replace function cruce_facturas(p_cufe text default null, p_nit_emisor text default null)
returns table (cufe text, nit_emisor text, prefijo text, folio text, documento text, tipo text, estado text, num_ingreso text, sede_id int)
language plpgsql stable security definer set search_path = public as $$
begin
  if mi_rol() not in ('admin', 'pagos') then raise exception 'sin permiso' using errcode = '42501'; end if;
  return query select f.cufe, f.nit_emisor, f.prefijo, f.folio, f.documento, f.tipo::text, f.estado::text, f.num_ingreso, f.sede_id
    from facturas f
    where (p_cufe is null and p_nit_emisor is null) or f.cufe = p_cufe or f.nit_emisor = p_nit_emisor
    order by f.cufe;
end $$;

create or replace function cruce_pedidos(p_factura_cufe text default null, p_numero_factura_contiene text default null)
returns table (numero text, proveedor_texto text, nit_proveedor text, factura_cufe text, pedido_erp text, numero_factura text)
language plpgsql stable security definer set search_path = public as $$
begin
  if mi_rol() not in ('admin', 'pagos') then raise exception 'sin permiso' using errcode = '42501'; end if;
  return query select p.numero, p.proveedor_texto, p.nit_proveedor, p.factura_cufe, p.pedido_erp, p.numero_factura
    from pedidos p
    where (p_factura_cufe is null and p_numero_factura_contiene is null and (p.numero_factura is not null or p.factura_cufe is not null))
       or (p_factura_cufe is not null and p.factura_cufe = p_factura_cufe)
       or (p_numero_factura_contiene is not null and p.numero_factura ilike '%' || p_numero_factura_contiene || '%')
    order by p.id;
end $$;

create or replace function cruce_erp_documento(p_su_doc_clave_contiene text default null, p_contacto_norm text default null)
returns table (causacion text, serie text, numero text, fecha date, su_doc text, su_doc_clave text, contacto text, contacto_norm text, almacen text, base numeric, impuestos numeric, neto numeric, tipo text, procesado boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if mi_rol() not in ('admin', 'pagos') then raise exception 'sin permiso' using errcode = '42501'; end if;
  return query select e.causacion, e.serie, e.numero, e.fecha, e.su_doc, e.su_doc_clave, e.contacto, e.contacto_norm, e.almacen, e.base, e.impuestos, e.neto, e.tipo, e.procesado
    from erp_documento e
    where (p_su_doc_clave_contiene is null and p_contacto_norm is null)
       or (p_su_doc_clave_contiene is not null and e.su_doc_clave ilike '%' || p_su_doc_clave_contiene || '%')
       or (p_contacto_norm is not null and e.contacto_norm = p_contacto_norm)
    order by e.causacion;
end $$;

create or replace function cruce_decisiones(p_cufe text default null)
returns table (cufe text, decision text, causacion_erp text, factura_relacionada text, nota text, decidido_por text)
language plpgsql stable security definer set search_path = public as $$
begin
  if mi_rol() not in ('admin', 'pagos') then raise exception 'sin permiso' using errcode = '42501'; end if;
  return query select d.cufe, d.decision, d.causacion_erp, d.factura_relacionada, d.nota, d.decidido_por from conciliacion_decision d where p_cufe is null or d.cufe = p_cufe;
end $$;

revoke all on function cruce_facturas(text, text) from public, anon;
revoke all on function cruce_pedidos(text, text) from public, anon;
revoke all on function cruce_erp_documento(text, text) from public, anon;
revoke all on function cruce_decisiones(text) from public, anon;
grant execute on function cruce_facturas(text, text) to authenticated;
grant execute on function cruce_pedidos(text, text) to authenticated;
grant execute on function cruce_erp_documento(text, text) to authenticated;
grant execute on function cruce_decisiones(text) to authenticated;
