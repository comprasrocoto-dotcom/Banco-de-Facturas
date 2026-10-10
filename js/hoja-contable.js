// ============================================================
//  hoja-contable.js  -  HOJA CONTABLE DEL ORGANIZADOR HIOPOS  (10/10/2026)
//  Plantilla de Contabilidad (12 columnas, en este orden): Familia, Fecha, Proveedor, Factura, Ingreso, ARTICULO, REFERENCIA,
//  SUBFAMILIA, CUENTA CONTAB, DEVOLUCION, GRUPO CUENTA, Observacion. UNA FILA POR ARTICULO de cada ingreso del Excel de Hiopos.
//  Fuentes (deterministico, sin IA):
//   - Excel "Documentos" de Hiopos: el alcance (solo esos ingresos), Fecha, Proveedor, Factura (Su Doc), Ingreso, Base/Imp/Neto.
//   - Articulos: el INFORME DE ARTICULOS de Hiopos ("FACTURAS DE COMPRA", una fila por articulo, por Serie / Numero) si se
//     cargo; si no, el PEDIDO DE LA WEB amarrado a la factura (Ingreso -> facturas.num_ingreso -> cufe -> pedidos -> lineas).
//     123 wok, Casa de Nadie y Sin Par no hacen pedidos en la web: sus articulos solo estan en ese informe de Hiopos.
//   - Clasificacion: cuentas_contables (hoja "Articulos" de Contabilidad: familia, subfamilia, grupo, referencia, cuenta,
//     devolucion) por NOMBRE EXACTO del articulo; aseo (SEDES / ADMON) segun el almacen; si no esta, regla por FAMILIA de
//     Hiopos CONFIRMADA por una persona (contable_regla_familia). Nada se inventa: lo que falta queda en Observacion.
//   - DIAN: el reporte no trae articulos; solo se dice si la factura esta o no.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HojaContable = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLUMNAS = ['Familia', 'Fecha', 'Proveedor', 'Factura', 'Ingreso', 'ARTICULO', 'REFERENCIA', 'SUBFAMILIA', 'CUENTA CONTAB', 'DEVOLUCION', 'GRUPO CUENTA', 'Observacion'];
  const SOPORTE = ['Ingreso', 'Factura', 'Proveedor', 'Almacén', 'ARTICULO', 'Cantidad', 'Valor total', 'Fuente de los artículos', 'Pedido web', 'Centro de costos', 'Regla de clasificación', 'Factura DIAN'];

  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const alnum = (s) => norm(s).replace(/[^A-Z0-9]/g, '');
  // "FC.COCINA / 5661", "FC.COCINA5661", "FCRC / 3795", "FCRC3795" -> "FCCOCINA5661" / "FCRC3795"
  const claveIngreso = (s) => alnum(s);
  const numero = (v) => {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v == null ? '' : v).trim().replace(/\$/g, '').replace(/\s/g, ''); if (!s) return null;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    const n = Number(s); return isFinite(n) ? n : null;
  };

  // ---- informe de articulos de Hiopos ("FACTURAS DE COMPRA": Fecha, Almacen, Serie / Numero, Tipo Documento, Centro de costos,
  //      Nif, Proveedor, Familia, Articulo, Subarticulo, Uds.C, Valor Unitario Con Impuesto, Total Neto). Los titulos pueden venir
  //      con las tildes rotas ("AlmacÃ©n"): se buscan por el comienzo.
  function leerInformeArticulos(aoa) {
    const datos = (aoa || []).map((r) => (Array.isArray(r) ? r : []));
    let fe = -1;
    for (let i = 0; i < Math.min(datos.length, 15); i++) {
      const hs = datos[i].map(norm);
      if (hs.some((h) => /^SERIE/.test(h)) && hs.some((h) => /^ART/.test(h)) && hs.some((h) => h === 'FAMILIA')) { fe = i; break; }
    }
    if (fe < 0) return { lineas: [], error: 'No encontré las columnas del informe de artículos de Hiopos (Serie / Número, Familia, Artículo...).' };
    const H = datos[fe].map(norm), col = (re) => H.findIndex((h) => re.test(h));
    const c = { fecha: col(/^FECHA/), alm: col(/^ALMAC/), serie: col(/^SERIE/), tipo: col(/^TIPO/), cc: col(/^CENTRO/), nif: col(/^NIF/), prov: col(/^PROVEEDOR/),
      fam: col(/^FAMILIA$/), art: col(/^ARTICULO|^ART.CULO|^ARTA/), sub: col(/^SUBART/), uds: col(/^UDS/), vu: col(/^VALOR UNIT/), tot: col(/^TOTAL/) };
    if (c.art < 0) c.art = H.findIndex((h, i) => /^ART/.test(h) && i !== c.sub);
    const v = (r, i) => (i >= 0 ? r[i] : '');
    const lineas = [];
    for (let i = fe + 1; i < datos.length; i++) {
      const r = datos[i], serie = String(v(r, c.serie) || '').trim(), art = String(v(r, c.art) || '').trim();
      if (!serie || !art) continue;
      lineas.push({ ingreso: serie, clave: claveIngreso(serie), almacen: String(v(r, c.alm) || '').trim(), tipoDoc: String(v(r, c.tipo) || '').trim(),
        centroCostos: String(v(r, c.cc) || '').trim(), proveedor: String(v(r, c.prov) || '').trim(), familia: String(v(r, c.fam) || '').trim(),
        articulo: art, subarticulo: String(v(r, c.sub) || '').trim(), cantidad: numero(v(r, c.uds)), valorUnitario: numero(v(r, c.vu)), total: numero(v(r, c.tot)) });
    }
    return { lineas, error: lineas.length ? null : 'El informe de artículos no trae líneas.' };
  }

  // Almacenes que son SEDES (restaurantes o plantas). Aseo de una sede = MATERIAL DE ASEO SEDES; si el almacen no es una sede
  // conocida no se adivina (queda por revisar). Decision del usuario 10/10/2026.
  const SEDES = ['OVIEDO', 'LAURELES', 'INTERPLAZA', 'TESORO', 'CENTRO DE PRODUCCION', 'CASA DE NADIE', 'SINPAR', 'SIN PAR', 'ROCOTO LAURELES', 'ROCOTO AMSTERDAM',
    'ROCOTO PROVENZA', 'ROCOTO', 'PLANTA PRODUCCION ROCOTO', 'PLANTA DE PRODUCCION', 'MALANGA', 'MALANGA DISTRITO VERA', 'MALANGA LAURELES', 'AMSTERDAM', 'PROVENZA'];
  const esSede = (almacen) => SEDES.includes(norm(almacen));

  // catalogo contable (cuentas_contables) -> Map(nombre normalizado -> [filas])
  function indexarCatalogo(filas) {
    const m = new Map();
    for (const f of filas || []) { const k = norm(f.articulo); if (!k || String(f.grupo_cuenta || '').startsWith('=')) continue; (m.get(k) || m.set(k, []).get(k)).push(f); }
    return m;
  }
  const deFila = (f) => ({ familia: f.familia || '', subfamilia: f.subfamilia || '', grupo: f.grupo_cuenta || '', referencia: f.referencia || '', cuenta: f.cuenta_contable || '', devolucion: f.cuenta_devolucion || '' });

  // articulo -> { ok, c (clasificacion), regla, obs }
  function homologar(articulo, familiaHiopos, almacen, cat, reglas) {
    const cands = (cat && cat.get(norm(articulo))) || [];
    if (cands.length) {
      const grupos = [...new Set(cands.map((f) => norm(f.grupo_cuenta)))];
      if (grupos.length === 1) { const c = deFila(cands[0]); return c.cuenta ? { ok: true, c, regla: 'artículo en el catálogo contable' } : { ok: false, c, regla: 'artículo en el catálogo contable', obs: 'Cuenta contable pendiente' }; }
      const sedes = cands.filter((f) => /SEDES/.test(norm(f.grupo_cuenta))), admon = cands.filter((f) => /ADMON/.test(norm(f.grupo_cuenta)));
      if (sedes.length && admon.length && sedes.length + admon.length === cands.length) {
        if (esSede(almacen)) return { ok: true, c: deFila(sedes[0]), regla: 'artículo en el catálogo; aseo de sede (' + almacen + ')' };
        return { ok: false, c: null, regla: '', obs: 'Aseo: ¿SEDES o ADMON? (el almacén "' + (almacen || '?') + '" no es una sede conocida)' };
      }
      return { ok: false, c: null, regla: '', obs: 'El artículo está en el catálogo con varios grupos (' + grupos.join(', ') + ')' };
    }
    const r = reglas && familiaHiopos ? reglas.get(norm(familiaHiopos)) : null;
    // regla de aseo de SEDES: solo vale si el almacen es una sede (si no, puede ser ADMON: no se adivina)
    if (r && r.activo !== false && /SEDES/.test(norm(r.grupo_cuenta)) && !esSede(almacen)) return { ok: false, c: null, regla: '', obs: 'Aseo: ¿SEDES o ADMON? (el almacén "' + (almacen || '?') + '" no es una sede conocida)' };
    if (r && r.activo !== false) return { ok: true, c: { familia: r.familia || r.familia_hiopos || '', subfamilia: r.subfamilia || '', grupo: r.grupo_cuenta, referencia: r.referencia || r.cuenta_contable, cuenta: r.cuenta_contable, devolucion: r.cuenta_devolucion || r.cuenta_contable }, regla: 'regla confirmada de la familia ' + (r.familia_hiopos || familiaHiopos) };
    return { ok: false, c: null, regla: '', obs: 'Producto sin homologación' + (familiaHiopos ? ' (familia ' + familiaHiopos + ')' : '') };
  }
  const indexarReglas = (filas) => new Map((filas || []).filter((r) => r && r.activo !== false).map((r) => [r.familia_norm || norm(r.familia_hiopos), r]));

  // Propuestas de regla por familia (solo SE PROPONEN; se aplican cuando alguien las confirma): familias de Hiopos de los
  // articulos sin homologar cuya familia o subfamilia en el catalogo tiene UN solo grupo y UNA sola cuenta. -> [{ familia_hiopos, ... , n }]
  function proponerReglas(sinHomologar, catalogoFilas, reglas) {
    const cuenta = new Map();
    for (const s of sinHomologar || []) { const k = norm(s.familia); if (!k || (reglas && reglas.has(k))) continue; cuenta.set(k, { familia_hiopos: s.familia, n: ((cuenta.get(k) || {}).n || 0) + 1 }); }
    const props = [];
    for (const [k, x] of cuenta) {
      // la familia de Hiopos se busca primero como FAMILIA del catalogo, luego como subfamilia y por ultimo como clasificacion
      const validas = (catalogoFilas || []).filter((f) => !String(f.grupo_cuenta || '').startsWith('=') && f.cuenta_contable);
      const filas = [(f) => norm(f.familia) === k, (f) => norm(f.subfamilia) === k, (f) => norm(f.clasificacion) === k].map((p) => validas.filter(p)).find((l) => l.length) || [];
      let claves = [...new Set(filas.map((f) => norm(f.grupo_cuenta) + '|' + f.cuenta_contable))];
      // aseo: la familia tiene SEDES y ADMON -> se propone la de SEDES (solo se aplica cuando el almacen es una sede)
      let usar = filas;
      if (claves.length === 2 && claves.some((c) => /SEDES/.test(c)) && claves.some((c) => /ADMON/.test(c))) { usar = filas.filter((f) => /SEDES/.test(norm(f.grupo_cuenta))); claves = [...new Set(usar.map((f) => norm(f.grupo_cuenta) + '|' + f.cuenta_contable))]; }
      if (usar.length && claves.length === 1) { const f = usar[0]; props.push({ familia_norm: k, familia_hiopos: x.familia_hiopos, familia: f.familia, subfamilia: f.subfamilia, grupo_cuenta: f.grupo_cuenta, referencia: f.referencia || f.cuenta_contable, cuenta_contable: f.cuenta_contable, cuenta_devolucion: f.cuenta_devolucion || f.cuenta_contable, n: x.n, base: filas.length }); }
      else props.push({ familia_norm: k, familia_hiopos: x.familia_hiopos, n: x.n, sinPropuesta: filas.length ? 'en el catálogo esa familia tiene varios grupos/cuentas' : 'esa familia no está en el catálogo' });
    }
    return props.sort((a, b) => b.n - a.n);
  }

  // ---- el cruce ----
  // documentos: filas clasificadas del Organizador ({ fila, v }) = el ALCANCE (solo esos ingresos).
  // informe: lineas de leerInformeArticulos (o []). web: { facturas:[{cufe,num_ingreso,documento,prefijo,folio}], pedidos:[{id,numero,factura_cufe,centro_costo}],
  //   lineas:[{pedido_id,codigo,insumo,cantidad,unidad}], familiaPorCodigo: Map } . catalogo: filas de cuentas_contables. reglas: filas de contable_regla_familia.
  // dian: registros de la DIAN (o null si no se cargo).
  // -> { filas: [{ celdas (12), soporte (12), obs, ok }], revisar: [...], sinHomologar: [...], resumen }
  function armar({ documentos, informe, web, catalogo, reglas, dian }) {
    const cat = indexarCatalogo(catalogo), R = indexarReglas(reglas), W = web || {};
    const porIngreso = new Map(); for (const l of informe || []) (porIngreso.get(l.clave) || porIngreso.set(l.clave, []).get(l.clave)).push(l);
    const cufePorIngreso = new Map(), cufesPorDoc = new Map();
    for (const f of W.facturas || []) {
      if (f.num_ingreso) cufePorIngreso.set(claveIngreso(f.num_ingreso), f.cufe);
      for (const d of new Set([alnum(f.documento), alnum((f.prefijo || '') + (f.folio || ''))].filter(Boolean))) (cufesPorDoc.get(d) || cufesPorDoc.set(d, new Set()).get(d)).add(f.cufe);
    }
    const pedidosPorCufe = new Map(); for (const p of W.pedidos || []) if (p.factura_cufe) (pedidosPorCufe.get(p.factura_cufe) || pedidosPorCufe.set(p.factura_cufe, []).get(p.factura_cufe)).push(p);
    const lineasPorPedido = new Map(); for (const l of W.lineas || []) (lineasPorPedido.get(l.pedido_id) || lineasPorPedido.set(l.pedido_id, []).get(l.pedido_id)).push(l);
    const famCod = W.familiaPorCodigo || new Map();
    const dianDocs = dian ? new Set(dian.map((d) => d.doc)) : null;

    const filas = [], revisar = [], sinHomologar = [];
    let docsConArticulos = 0, docsSinArticulos = 0;
    for (const x of documentos || []) {
      const v = x.v, ingreso = v.INGRESO || '', clave = claveIngreso(ingreso), suDoc = String(v['Su Doc'] || '');
      const base = { fecha: v['Fecha Doc'] || null, proveedor: v.Contacto || '', factura: suDoc, ingreso, almacen: v['Almacén'] || '' };
      const obsDoc = [];
      const enDian = dianDocs ? dianDocs.has(alnum(suDoc)) : null;
      if (dianDocs && !enDian) obsDoc.push('Factura de la DIAN no encontrada');
      // 1) informe de articulos de Hiopos (lo que realmente entro al ERP en ese ingreso)
      let lineas = [], fuente = '', pedidoTxt = '', centro = '';
      // 123 wok y Sin Par usan las MISMAS series (FC.BAR / 58 existe en las dos empresas): ademas del ingreso tiene que coincidir
      // el almacen; si el documento no trae almacen y hay lineas de varios almacenes, no se elige (queda por revisar)
      let delInforme = clave ? (porIngreso.get(clave) || []) : [];
      const almacenes = [...new Set(delInforme.map((l) => norm(l.almacen)))];
      if (almacenes.length > 1 || (almacenes.length === 1 && base.almacen && almacenes[0] && almacenes[0] !== norm(base.almacen))) {
        const mismo = delInforme.filter((l) => norm(l.almacen) === norm(base.almacen));
        if (!mismo.length && delInforme.length) obsDoc.push('El ingreso ' + ingreso + ' está en el informe de artículos con otro almacén (' + almacenes.join(', ') + '): no se usó');
        delInforme = mismo;
      }
      if (delInforme.length) {
        fuente = 'Informe de artículos de Hiopos';
        centro = [...new Set(delInforme.map((l) => l.centroCostos).filter(Boolean))].join(', ');
        lineas = delInforme.map((l) => ({ articulo: l.articulo, familia: l.familia, cantidad: l.cantidad, total: l.total, almacen: l.almacen || base.almacen, devolucion: /ABONO|DEVOL/i.test(l.tipoDoc) }));
        const suma = Math.round(delInforme.reduce((s, l) => s + (Number(l.total) || 0), 0));
        const esperado = Math.round(Math.abs(Number(v.Base) || 0) + Math.abs(Number(v.Impuestos) || 0));
        if (esperado && Math.abs(Math.abs(suma) - esperado) > 1) obsDoc.push('Diferencia: los artículos suman $ ' + Math.abs(suma).toLocaleString('es-CO') + ' y el ingreso (base + impuestos) $ ' + esperado.toLocaleString('es-CO'));
      } else {
        // 2) pedido de la web amarrado a la factura: por el N° de ingreso; si no, por el numero de factura (solo si es UNA factura)
        let cufe = clave ? cufePorIngreso.get(clave) : null;
        if (!cufe) { const s = cufesPorDoc.get(alnum(suDoc)); if (s && s.size === 1) cufe = [...s][0]; else if (s && s.size > 1) obsDoc.push('Varias facturas de la web con ese número: no se eligió ninguna'); }
        const peds = cufe ? (pedidosPorCufe.get(cufe) || []) : [];
        if (peds.length) {
          fuente = 'Pedido de la web';
          pedidoTxt = peds.map((p) => p.numero).join(', ');
          centro = [...new Set(peds.map((p) => p.centro_costo).filter(Boolean))].join(', ');
          if (peds.length > 1) obsDoc.push('Factura con ' + peds.length + ' pedidos amarrados (' + pedidoTxt + ')');
          // marcas con centro de costo obligatorio (serie FC.COCINA, FC.BAR...): el pedido tiene que traerlo
          if (/^FC\s*\./i.test(ingreso) && (!centro || /VARIOS/.test(centro))) obsDoc.push(centro ? 'Centro de costos VARIOS (factura mixta): revisar' : 'Centro de costos faltante en el pedido');
          for (const p of peds) for (const l of lineasPorPedido.get(p.id) || []) lineas.push({ articulo: l.insumo, familia: famCod.get(norm(l.codigo)) || l.subfamilia || '', cantidad: l.cantidad, total: null, almacen: base.almacen, pedido: p.numero });
          if (!lineas.length) obsDoc.push('Pedido sin artículos');
        } else obsDoc.push('Pedido no encontrado (sin pedido en la web ni informe de artículos de Hiopos para este ingreso)');
      }
      if (!ingreso) obsDoc.push('Ingreso de Hiopos vacío');
      if (lineas.length) docsConArticulos++; else docsSinArticulos++;
      const enDianTxt = dianDocs ? (enDian ? 'Sí (sin detalle de artículos)' : 'No encontrada') : 'No se cargó el reporte';
      if (!lineas.length) {
        const obs = obsDoc.join('; ');
        filas.push({ ok: false, obs, celdas: ['', base.fecha, base.proveedor, base.factura, ingreso, '', '', '', '', '', '', obs],
          soporte: [ingreso, base.factura, base.proveedor, base.almacen, '', null, null, fuente || '—', pedidoTxt, centro, '', enDianTxt] });
        revisar.push({ fila: x.fila, ingreso, factura: base.factura, proveedor: base.proveedor, articulo: '', motivo: obs });
        continue;
      }
      lineas.forEach((l, i) => {
        const h = homologar(l.articulo, l.familia, l.almacen, cat, R);
        const obs = [...(i === 0 ? obsDoc : obsDoc.filter((o) => !/^Diferencia/.test(o)))];
        if (!h.ok && h.obs) obs.push(h.obs);
        if (l.devolucion) obs.push('Devolución (abono factura compra)');
        const c = h.c || {};
        const familia = c.familia || '';
        if (!h.ok) sinHomologar.push({ articulo: l.articulo, familia: l.familia, ingreso });
        filas.push({ ok: h.ok && !obsDoc.length, obs: obs.join('; '),
          celdas: [familia, base.fecha, base.proveedor, base.factura, ingreso, l.articulo, c.referencia || '', c.subfamilia || '', c.cuenta || '', c.devolucion || '', c.grupo || '', obs.join('; ')],
          soporte: [ingreso, base.factura, base.proveedor, l.almacen, l.articulo, l.cantidad, l.total, fuente, l.pedido || pedidoTxt, centro, h.regla || '—', enDianTxt] });
        if (obs.length) revisar.push({ fila: x.fila, ingreso, factura: base.factura, proveedor: base.proveedor, articulo: l.articulo, motivo: obs.join('; ') });
      });
    }
    const conCuenta = filas.filter((f) => f.celdas[8]).length;
    return { filas, revisar, sinHomologar, resumen: { documentos: (documentos || []).length, docsConArticulos, docsSinArticulos, lineas: filas.length, conCuenta, sinCuenta: filas.length - conCuenta, listas: filas.filter((f) => f.ok && !f.obs).length } };
  }

  // ---- hojas del Excel (ExcelJS) ----
  const fechaExcel = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  function hoja(wb, nombre, titulos, filas, anchos, color) {
    const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(titulos);
    const enc = ws.getRow(1); enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    enc.eachCell((cel) => { cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color || 'FF1E3A8A' } }; });
    for (const f of filas) ws.addRow(f);
    titulos.forEach((t, i) => { const col = ws.getColumn(i + 1); col.width = anchos[i] || 14; if (/^Fecha$/.test(t)) col.numFmt = 'dd/mm/yyyy'; if (/^(Valor total|Cantidad)$/.test(t)) col.numFmt = '#,##0.##'; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titulos.length } };
    return ws;
  }
  // agrega "Contabilidad" (la plantilla, 12 columnas), "Soporte contable" (trazabilidad) y "Por revisar contable"
  function agregarHojas(wb, r) {
    const conFecha = (c) => c.map((x, i) => (i === 1 ? fechaExcel(x) : x));
    const ws = hoja(wb, 'Contabilidad', COLUMNAS, r.filas.map((f) => conFecha(f.celdas)), [22, 12, 36, 16, 18, 42, 13, 22, 14, 14, 26, 50], 'FF1E3A8A');
    // texto en las celdas de codigos (no numeros): las cuentas y referencias se conservan tal cual
    ['REFERENCIA', 'CUENTA CONTAB', 'DEVOLUCION', 'Factura', 'Ingreso'].forEach((t) => { ws.getColumn(COLUMNAS.indexOf(t) + 1).numFmt = '@'; });
    r.filas.forEach((f, i) => { if (f.obs) ws.getRow(i + 2).getCell(12).font = { color: { argb: 'FFB91C1C' } }; });
    hoja(wb, 'Soporte contable', SOPORTE, r.filas.map((f) => f.soporte), [18, 16, 34, 18, 40, 10, 14, 28, 16, 18, 44, 24], 'FF0F766E');
    hoja(wb, 'Por revisar contable', ['Fila del archivo', 'Ingreso', 'Factura', 'Proveedor', 'ARTICULO', 'Motivo'],
      r.revisar.map((x) => [x.fila, x.ingreso, x.factura, x.proveedor, x.articulo, x.motivo]), [10, 18, 16, 34, 40, 70], 'FFB45309');
  }

  return { COLUMNAS, SOPORTE, SEDES, norm, alnum, claveIngreso, esSede, leerInformeArticulos, indexarCatalogo, indexarReglas, homologar, proponerReglas, armar, agregarHojas };
});
