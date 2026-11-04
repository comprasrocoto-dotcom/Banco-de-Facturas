-- ============================================================
--  REPORTE: ¿QUIÉN INGRESA, EL AGENTE O EL ANALISTA?  -  03/11/2026, pedido del usuario:
--  «un reporte donde pueda revisar realmente cuántos ingresos hace el agente y cuántos termina el analista, para hacer
--   seguimiento del rendimiento del agente y evaluar puntos a mejorar»
-- ============================================================
-- Una fila por pedido con factura amarrada (de la fecha elegida), con COMO quedo ingresado al ERP:
--   AGENTE            -> la cola de ingresos lo termino (ingreso_documento COMPLETADO)
--   ANALISTA_TRAS_FALLO -> el agente lo intento, fallo y un analista lo saco de la cola y lo termino a mano (DESCARTADO)
--   ANALISTA_DIRECTO  -> nunca paso por el agente: un analista lo ingreso a mano
--   PENDIENTE         -> todavia no esta ingresado (en cola, con error o sin lanzar)
-- Analista = el responsable de la sede del pedido (perfil_sede). Ademas: quien lanzo la orden del agente y quien anoto a mano el
-- numero de ingreso (historial). Error del agente: etapa y detalle que dejo en la cola (para ver que mejorar).
-- Solo LEE (una funcion nueva, solo administrador). Repetirlo no hace nada.

create or replace function public.reporte_ingresos(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if mi_rol() <> 'admin' then raise exception 'Solo el administrador puede ver este reporte.' using errcode = '42501'; end if;
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

revoke all on function public.reporte_ingresos(date, date) from public, anon;
grant execute on function public.reporte_ingresos(date, date) to authenticated;
