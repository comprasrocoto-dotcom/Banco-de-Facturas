-- ============================================================
--  EVALUACION DE PROVEEDORES (16/10/2026, pedido del usuario)
-- ============================================================
-- Cada proveedor se califica de 1 a 100% en 4 puntos (calculo en js/evaluacion-proveedores.js):
--   📦 Entregas completas  (lineas del pedido que no vinieron en la factura, o la sede reporto «No llegó el pedido completo»)
--   ↩️ Sin devoluciones    (facturas sin nota credito amarrada)
--   📈 Precios estables    (articulos que no subieron mas del X% frente a la compra anterior; precio_historial)
--   ⏱️ Entrega a tiempo    (fecha del pedido -> fecha recibido en maximo N dias)
-- Solo aditivo: 2 columnas de metas con valor por defecto, una funcion de lectura nueva (solo administrador) y la de
-- configuracion gana 2 parametros opcionales (los que ya la llaman siguen igual).

alter table evaluacion_config add column if not exists dias_entrega_prov int not null default 2 check (dias_entrega_prov between 0 and 30);
alter table evaluacion_config add column if not exists alza_pct numeric not null default 5 check (alza_pct between 0 and 100);

create or replace function evaluacion_proveedores_datos(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador ve la evaluacion.' using errcode = '42501'; end if;
  return (
    with peds as (
      select id, numero, proveedor_id, proveedor_texto, sede_id, fecha, fecha_recibido, factura_cufe, estado
        from pedidos
       where coalesce(fecha, created_at::date) between p_desde and p_hasta and coalesce(estado::text, '') <> 'anulado'
    )
    select jsonb_build_object(
      'proveedores', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nit', nit, 'razon_social', razon_social, 'nombre_comercial', nombre_comercial)), '[]') from proveedores),
      'pedidos', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from peds p),
      'lineas', (select coalesce(jsonb_agg(jsonb_build_object('pedido_id', l.pedido_id, 'codigo', l.codigo, 'insumo', l.insumo, 'cantidad', l.cantidad)), '[]')
                   from pedido_lineas l where l.pedido_id in (select id from peds where factura_cufe is not null)),
      'lineas_factura', (select coalesce(jsonb_agg(jsonb_build_object('factura_cufe', h.factura_cufe, 'codigo', h.codigo, 'articulo', h.articulo_texto, 'cantidad', h.cantidad)), '[]')
                   from precio_historial h where h.factura_cufe in (select factura_cufe from peds where factura_cufe is not null)),
      'facturas', (select coalesce(jsonb_agg(jsonb_build_object('cufe', cufe, 'nit_emisor', nit_emisor, 'emisor', emisor, 'tipo', tipo, 'total', total,
                     'fecha_emision', fecha_emision, 'prefijo', prefijo, 'folio', folio, 'sede_id', sede_id)), '[]')
                   from facturas where fecha_emision between p_desde - 15 and p_hasta + 15),
      'notas', (select coalesce(jsonb_agg(jsonb_build_object('nota_cufe', nota_cufe, 'factura_cufe', factura_cufe)), '[]') from nota_credito_factura),
      'precios', (select coalesce(jsonb_agg(jsonb_build_object('nit', proveedor_nit, 'proveedor', proveedor_nombre, 'clave', articulo_clave, 'articulo', articulo_texto,
                     'precio', precio, 'fecha', fecha, 'factura', factura_ref)), '[]')
                   from precio_historial where fecha between p_desde - 180 and p_hasta),
      'novedades', (select coalesce(jsonb_agg(jsonb_build_object('cufe', cufe, 'motivo', motivo, 'sede_id', sede_id, 'created_at', created_at)), '[]')
                   from novedades where motivo ilike '%completo%' and created_at >= p_desde - 15),
      'config', (select to_jsonb(c) from evaluacion_config c where id = 1)
    )
  );
end $$;
revoke all on function evaluacion_proveedores_datos(date, date) from public, anon;
grant execute on function evaluacion_proveedores_datos(date, date) to authenticated, service_role;

-- configuracion: + dias maximos de entrega y % de alza (opcionales; misma validacion de antes)
drop function if exists evaluacion_config_guardar(jsonb, int, text, int, int, int);
create or replace function evaluacion_config_guardar(p_pesos jsonb, p_dias int default null, p_usuario text default null,
                                                     p_hora_corte int default null, p_hora_manana int default null, p_max_sin_asignar int default null,
                                                     p_dias_entrega int default null, p_alza_pct numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v_suma numeric := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then raise exception 'Solo un administrador cambia la evaluacion.' using errcode = '42501'; end if;
  foreach k in array array['envio', 'sinAsignar', 'ingresos', 'correcciones', 'proceso'] loop
    if jsonb_typeof(p_pesos -> k) <> 'number' or (p_pesos ->> k)::numeric < 0 then raise exception 'El peso de % tiene que ser un numero de 0 o mas.', k using errcode = '22023'; end if;
    v_suma := v_suma + (p_pesos ->> k)::numeric;
  end loop;
  if v_suma <> 100 then raise exception 'Los pesos tienen que sumar 100%% (suman %).', v_suma using errcode = '22023'; end if;
  if p_hora_corte is not null and (p_hora_corte < 6 or p_hora_corte > 23) then raise exception 'La hora de corte va de 6 a 23.' using errcode = '22023'; end if;
  if p_hora_manana is not null and (p_hora_manana < 6 or p_hora_manana > 23) then raise exception 'La hora de la mañana va de 6 a 23.' using errcode = '22023'; end if;
  if p_max_sin_asignar is not null and (p_max_sin_asignar < 0 or p_max_sin_asignar > 500) then raise exception 'El maximo de Sin asignar va de 0 a 500.' using errcode = '22023'; end if;
  if p_dias_entrega is not null and (p_dias_entrega < 0 or p_dias_entrega > 30) then raise exception 'Los dias de entrega van de 0 a 30.' using errcode = '22023'; end if;
  if p_alza_pct is not null and (p_alza_pct < 0 or p_alza_pct > 100) then raise exception 'El %% de alza va de 0 a 100.' using errcode = '22023'; end if;
  update evaluacion_config set
         pesos = jsonb_build_object('envio', p_pesos -> 'envio', 'sinAsignar', p_pesos -> 'sinAsignar', 'ingresos', p_pesos -> 'ingresos', 'correcciones', p_pesos -> 'correcciones', 'proceso', p_pesos -> 'proceso'),
         dias_alerta = coalesce(p_dias, dias_alerta),
         hora_corte = coalesce(p_hora_corte, hora_corte), hora_manana = coalesce(p_hora_manana, hora_manana), max_sin_asignar = coalesce(p_max_sin_asignar, max_sin_asignar),
         dias_entrega_prov = coalesce(p_dias_entrega, dias_entrega_prov), alza_pct = coalesce(p_alza_pct, alza_pct),
         actualizado_en = now(), actualizado_por = nullif(btrim(coalesce(p_usuario, '')), '')
   where id = 1;
end $$;
revoke all on function evaluacion_config_guardar(jsonb, int, text, int, int, int, int, numeric) from public, anon;
grant execute on function evaluacion_config_guardar(jsonb, int, text, int, int, int, int, numeric) to authenticated, service_role;
