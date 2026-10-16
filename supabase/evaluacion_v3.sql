-- ============================================================
--  EVALUACION v3 (16/10/2026): evaluacion de SEDES por sus responsabilidades (montar pedidos y aceptar facturas)
-- ============================================================
-- Solo cambia la funcion de lectura evaluacion_datos: agrega quien monto cada pedido (pedidos.subido_por) y quien se
-- asigno y sello cada factura (facturas.asignada_por / sellada_por). No toca tablas ni datos.

-- ---------------------------------------------------------------- datos para calificar (solo administrador)
create or replace function evaluacion_datos(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador ve la evaluacion.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'perfiles', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'nombre', nombre, 'rol', rol, 'activo', activo, 'sede_id', sede_id)), '[]') from perfiles),
    'sedes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'marca_id', marca_id)), '[]') from sedes),
    'marcas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre)), '[]') from marcas),
    'facturas', (select coalesce(jsonb_agg(jsonb_build_object('cufe', cufe, 'sede_id', sede_id, 'marca_id', marca_id, 'tipo', tipo, 'estado', estado,
        'num_ingreso', num_ingreso, 'fecha_ingreso', fecha_ingreso, 'sellada_en', sellada_en, 'asignada_por', asignada_por, 'asignada_en', asignada_en, 'sellada_por', sellada_por, 'created_at', created_at, 'prefijo', prefijo, 'folio', folio, 'emisor', emisor)), '[]') from facturas),
    'pedidos', (select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'sede_id', sede_id, 'factura_cufe', factura_cufe, 'estado', estado, 'subido_por', subido_por)), '[]') from pedidos),
    'historial', (select coalesce(jsonb_agg(jsonb_build_object('accion', accion, 'usuario', usuario, 'cufe', cufe, 'detalle', detalle, 'created_at', created_at)), '[]') from historial
                   where created_at >= p_desde - 7 and created_at < p_hasta + 2
                     and accion in ('pedido creado desde la web', 'pedido amarrado', 'pedido amarrado por foto', 'numero de ingreso ERP', 'numero de ingreso ERP (manual)',
                                    'pedido desamarrado', 'sello quitado - devuelta al pool', 'pedido borrado', 'factura borrada', 'asignada', 'asignada por admin')),
    'docs_ingreso', (select coalesce(jsonb_agg(jsonb_build_object('factura_cufe', factura_cufe, 'terminado_en', t)), '[]')
                      from (select factura_cufe, max(terminado_en) as t from ingreso_documento where estado = 'COMPLETADO' and factura_cufe is not null group by factura_cufe) x),
    'envios', (select coalesce(jsonb_agg(jsonb_build_object('factura_cufe', factura_cufe, 'lote_id', lote_id, 'enviada_en', enviada_en)), '[]') from contabilidad_envio),
    'lotes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'creado_por', creado_por, 'usuario', usuario, 'creado_en', creado_en, 'anulado', anulado)), '[]') from contabilidad_lote),
    'avisos', (select coalesce(jsonb_agg(jsonb_build_object('factura_cufe', factura_cufe, 'pedido_numero', pedido_numero, 'motivo', motivo, 'creado_en', creado_en)), '[]') from agente_aviso
                where creado_en >= p_desde - 30),
    'ordenes', (select coalesce(jsonb_agg(jsonb_build_object('pedida_por', pedida_por, 'pedida_en', pedida_en, 'tipo', tipo)), '[]') from ordenes
                 where pedida_en >= p_desde - 1 and pedida_en < p_hasta + 2),
    'responsables', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'sede_id', sede_id)), '[]') from evaluacion_responsable),
    'config', (select to_jsonb(c) from evaluacion_config c where id = 1),
    'fotos', (select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'marca_id', marca_id, 'pool', pool, 'viejas', viejas)), '[]') from evaluacion_foto where dia between p_desde and p_hasta),
    'alertas', (select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'user_id', user_id, 'tipo', tipo, 'nombre', nombre, 'cantidad', cantidad, 'max_dias', max_dias)), '[]') from evaluacion_alerta where dia between p_desde and p_hasta)
  );
end $$;

