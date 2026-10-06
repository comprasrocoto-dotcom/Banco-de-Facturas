-- ============================================================
--  desamarrar_pedido_factura.sql  -  SOLTAR UNA FACTURA DE SU PEDIDO (sin borrar nada)  -  06/10/2026   ADITIVO
--  Caso real: 1FEV1374564 (JUAN D HOYOS) se amarro a un pedido que no era; como no habia forma de soltarla, se
--  BORRO la factura del banco (boton 🗑) y despues no se pudo volver a subir.
--
--  1) pedido_factura_desamarrar(): deja el pedido SIN factura y la factura LIBRE en el banco (no se borra nada).
--     - mismo permiso que amarrar: admin, pagos, o la sede dueña del pedido;
--     - si el agente lo esta ingresando AHORA (PROCESANDO / PEDIDO_CREADO / FACTURANDO, con latido de menos de
--       30 min) no se deja: se espera o se detiene el proceso;
--     - si YA quedo en el ERP (pedido_erp, N° de ingreso de la factura, pedido facturado o documento COMPLETADO),
--       soltarlo aqui NO lo quita del ERP: solo un ADMIN puede hacerlo, con un motivo (queda en historial);
--     - un documento en ERROR / pendiente vuelve a PENDIENTE sin error (la factura cambio): cuando se amarre la
--       correcta, el agente la toma como nueva;
--     - la fecha de enlace (factura_amarrada_en) la limpia el trigger de siempre.
--  2) dian_encolar(): una descarga que quedo "subida" pero cuya factura YA NO esta en el banco (la borraron) vuelve a
--     "pendiente" al pedirla otra vez desde el cruce. Antes contaba como "ya en cola" y el vigilante ignoraba el PDF.
--  No cambia ninguna tabla ni politica.
-- ============================================================

create or replace function pedido_factura_desamarrar(p_pedido_id bigint, p_usuario text default null, p_forzar boolean default false, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_p pedidos%rowtype; v_f facturas%rowtype; v_doc ingreso_documento%rowtype;
  v_hay_f boolean; v_hay_doc boolean; v_num text; v_erp text;
begin
  select * into v_p from pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Ese pedido no existe.' using errcode = '22023'; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and mi_rol() not in ('admin', 'pagos')
     and not (mi_rol() = 'sede' and (v_p.sede_id = mi_sede() or v_p.marca_id = mi_marca()))
  then
    raise exception 'Sin permiso para desamarrar este pedido.' using errcode = '42501';
  end if;
  if v_p.factura_cufe is null then raise exception 'Este pedido no tiene factura amarrada.' using errcode = '22023'; end if;

  select * into v_f from facturas where cufe = v_p.factura_cufe; v_hay_f := found;
  select * into v_doc from ingreso_documento where pedido_id = p_pedido_id; v_hay_doc := found;
  v_num := coalesce(nullif(btrim(v_f.documento), ''), nullif(coalesce(v_f.prefijo, '') || coalesce(v_f.folio, ''), ''), left(v_p.factura_cufe, 12));

  if v_hay_doc and v_doc.estado in ('PROCESANDO', 'PEDIDO_CREADO', 'FACTURANDO') and v_doc.actualizado_en > now() - interval '30 minutes' then
    raise exception 'El agente está ingresando este pedido al ERP en este momento. Espera a que termine (o deténlo) y vuelve a intentar.' using errcode = '55006';
  end if;

  v_erp := coalesce(nullif(btrim(v_p.pedido_erp), ''),
                    case when v_hay_f then nullif(btrim(v_f.num_ingreso), '') end,
                    case when v_hay_doc and v_doc.estado = 'COMPLETADO' then coalesce(nullif(btrim(v_doc.error), ''), 'completado') end,
                    case when v_p.estado = 'facturado' then 'facturado' end);
  if v_erp is not null then
    if not coalesce(p_forzar, false) then
      raise exception 'La factura % ya se ingresó al ERP (%). Desamarrarla aquí NO la quita del ERP: solo un administrador puede hacerlo, con un motivo.', v_num, v_erp using errcode = '22023';
    end if;
    if coalesce(auth.role(), '') <> 'service_role' and mi_rol() <> 'admin' then
      raise exception 'Solo un administrador puede desamarrar una factura que ya está en el ERP.' using errcode = '42501';
    end if;
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribe el motivo para desamarrar una factura que ya está en el ERP.' using errcode = '22023'; end if;
  end if;

  update pedidos set factura_cufe = null, numero_factura = null where id = p_pedido_id;

  if v_hay_doc and v_doc.estado in ('ERROR', 'PENDIENTE', 'PENDIENTE_REINTENTO') then
    update ingreso_documento set estado = 'PENDIENTE', etapa = 'factura desamarrada: espera la factura correcta', error = null, error_etapa = null,
           actualizado_en = now(), terminado_en = null where pedido_id = p_pedido_id;
  end if;

  insert into historial (cufe, accion, de, a, detalle, usuario)
  values (case when v_hay_f then v_p.factura_cufe end, 'pedido desamarrado', v_p.numero, null,
          v_num || ' ya no está amarrada a ' || coalesce(v_p.numero, '') || ' · ' || coalesce(nullif(btrim(p_usuario), ''), 'web')
            || case when v_erp is not null then ' · YA ESTABA EN EL ERP (' || v_erp || '): ' || btrim(p_motivo) else '' end,
          auth.uid());
  return v_num;
end
$$;
revoke all on function pedido_factura_desamarrar(bigint, text, boolean, text) from public;
grant execute on function pedido_factura_desamarrar(bigint, text, boolean, text) to authenticated;

-- (2) dian_encolar: igual que antes + una descarga "subida" cuya factura ya no esta en el banco vuelve a pendiente
create or replace function dian_encolar(p_items jsonb, p_marca integer, p_usuario text default null)
returns table(encolados integer, ya_en_sistema integer, ya_en_cola integer, invalidos integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare it jsonb; v_cufe text; v_nit text; v_id bigint; v_cat categoria_doc; v_tipo text;
        v_fecha date; v_total numeric; n_enc int := 0; n_sis int := 0; n_cola int := 0; n_inv int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and mi_rol() not in ('admin','pagos') then
    raise exception 'sin permiso para encolar descargas de la DIAN';
  end if;
  if not exists (select 1 from marcas where id = p_marca) then raise exception 'marca desconocida: %', p_marca; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items debe ser una lista'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'maximo 500 facturas por envio'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_cufe := lower(regexp_replace(coalesce(it->>'cufe',''), '[^0-9a-fA-F]', '', 'g'));
    v_nit  := regexp_replace(coalesce(it->>'nit_emisor',''), '\D', '', 'g');
    v_tipo := case when it->>'tipo' = 'nota_credito' then 'nota_credito' else 'factura' end;
    if length(v_cufe) <> 96 or v_nit = '' then n_inv := n_inv + 1; continue; end if;
    if exists (select 1 from facturas f where lower(f.cufe) = v_cufe) then n_sis := n_sis + 1; continue; end if;
    v_cat := coalesce((select c.categoria from categorias_proveedor c where c.nit = v_nit limit 1), 'insumos'::categoria_doc);
    begin v_fecha := nullif(it->>'fecha_emision','')::date; exception when others then v_fecha := null; end;
    begin v_total := nullif(it->>'total','')::numeric; exception when others then v_total := null; end;
    v_id := null;
    insert into dian_descarga (cufe, marca_id, tipo, categoria, nit_emisor, nit_receptor, prefijo, folio, documento, emisor, fecha_emision, total, pedido_por)
    values (v_cufe, p_marca, v_tipo, v_cat, v_nit, nullif(regexp_replace(coalesce(it->>'nit_receptor',''), '\D', '', 'g'), ''),
            nullif(it->>'prefijo',''), nullif(it->>'folio',''), nullif(it->>'documento',''), nullif(it->>'emisor',''), v_fecha, v_total, p_usuario)
    on conflict (cufe) do nothing returning dian_descarga.id into v_id;
    if v_id is not null then n_enc := n_enc + 1; continue; end if;
    -- (06/10/2026) 'subida' tambien: aqui ya se sabe que la factura NO esta en el banco (se borro despues de subirla)
    update dian_descarga d set estado = 'pendiente', intentos = 0, proximo_intento_en = now(), marca_id = p_marca, tipo = v_tipo,
           subida_en = case when d.estado = 'subida' then null else d.subida_en end,
           archivo_pdf = case when d.estado = 'subida' then null else d.archivo_pdf end,
           ultimo_error = case when d.estado = 'subida' then 'se había subido y la borraron del banco: se vuelve a pedir' else d.ultimo_error end
     where d.cufe = v_cufe and d.estado in ('error','agotado','subida') returning d.id into v_id;
    if v_id is not null then n_enc := n_enc + 1; else n_cola := n_cola + 1; end if;
  end loop;
  return query select n_enc, n_sis, n_cola, n_inv;
end $function$;
