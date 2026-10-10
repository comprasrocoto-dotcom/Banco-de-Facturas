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
  // (10/10/2026) + Base, Impuestos, Neto y Retención al final (pedido del usuario): valores de la FACTURA (reporte de la DIAN), en la
  // PRIMERA linea de cada factura (la DIAN no los trae por articulo; repetirlos en cada linea duplicaria los totales al sumar)
  // (10/10/2026) el usuario pidio Base, Impuestos, Neto y Retención DESPUES de ARTICULO. Las filas se arman por NOMBRE de columna
  // (celdasDe), asi un cambio de orden solo se hace aqui.
  const COLUMNAS = ['Familia', 'Fecha', 'Proveedor', 'Factura', 'Ingreso', 'ARTICULO', 'Base', 'Impuestos', 'Neto', 'REFERENCIA', 'SUBFAMILIA', 'CUENTA CONTAB', 'DEVOLUCION', 'GRUPO CUENTA', 'Observacion'];
  const IX = Object.fromEntries(COLUMNAS.map((c, i) => [c, i]));
  const CAMPO = { Familia: 'familia', Fecha: 'fecha', Proveedor: 'proveedor', Factura: 'factura', Ingreso: 'ingreso', ARTICULO: 'articulo', Base: 'base', Impuestos: 'impuestos', Neto: 'neto',
    REFERENCIA: 'referencia', SUBFAMILIA: 'subfamilia', 'CUENTA CONTAB': 'cuenta', DEVOLUCION: 'devolucion', 'GRUPO CUENTA': 'grupo', Observacion: 'obs' };
  const celdasDe = (o) => COLUMNAS.map((c) => { const v = o[CAMPO[c]]; return v === undefined ? (['Base', 'Impuestos', 'Neto'].includes(c) ? null : '') : v; });
  const SOPORTE = ['Ingreso', 'Factura', 'Proveedor', 'Almacén', 'ARTICULO', 'Cantidad', 'Neto del artículo', 'Fuente de los artículos', 'Pedido web', 'Centro de costos', 'Regla de clasificación', 'Factura DIAN', 'De dónde salen los valores'];
  // Tabla de retenciones de Contabilidad (hoja "Retenciones"; todas son de COMPRAS / pagos a proveedores, confirmado 10/10/2026)
  const RETENCIONES = [
    { nombre: 'Compras', pct: 2.5, cuenta: '236540030000', devolucion: '236540030000', tipo: 'Compras' },
    { nombre: 'Compras', pct: 3.5, cuenta: '236540010000', devolucion: '236540010000', tipo: 'Compras' },
    { nombre: 'Servicios Generales', pct: 4, cuenta: '236525020000', devolucion: '236525020000', tipo: 'Servicios' },
    { nombre: 'Servicios restaurante/catering', pct: 3.5, cuenta: '236525040000', devolucion: '236525040000', tipo: 'Servicios' },
    { nombre: 'Servicios Aseo y Vigilancia', pct: 2, cuenta: '236525050000', devolucion: '236525050000', tipo: 'Servicios' },
    { nombre: 'Servicios R.S', pct: 6, cuenta: '236525030000', devolucion: '236525030000', tipo: 'Servicios' },
    { nombre: 'Honorarios Persona Natural', pct: 11, cuenta: '236515010000', devolucion: '236515010000', tipo: 'Servicios' },
    { nombre: 'Honorarios persona Juridica', pct: 10, cuenta: '236515020000', devolucion: '236515020000', tipo: 'Servicios' },
    { nombre: 'Comisiones Plataformas (RAPPI UBER)', pct: 10, cuenta: '236520020000', devolucion: '236520020000', tipo: 'Comisiones' },
    { nombre: 'Comisiones Plataformas P.J', pct: 11, cuenta: '236520010000', devolucion: '236520010000', tipo: 'Comisiones' },
    { nombre: 'Arrendamiento local comercial', pct: 3.5, cuenta: '236530010000', devolucion: '236530010000', tipo: 'Arrendamiento' },
    { nombre: 'IVA retenido R.C', pct: 15, cuenta: '236705010000', devolucion: '236705010000', tipo: 'IVA' },
    { nombre: 'Reteica servicios', pct: null, cuenta: '236805010000', devolucion: '236805010000', tipo: 'Depende del municipio' },
    { nombre: 'Reteica Industria y Comercio', pct: null, cuenta: '236805020000', devolucion: '236805020000', tipo: '' },
  ];
  // retencion / base -> porcentaje y su(s) linea(s) de la tabla. Si el % calza con varias (ej. 3,5%: Compras, Servicios
  // restaurante, Arrendamiento) NO se elige: se dicen las opciones. -> { pct, opciones, texto, unica }
  function tipoRetencion(base, retencion) {
    const b = Math.abs(Number(base) || 0), r = Math.abs(Number(retencion) || 0);
    if (!r) return { pct: 0, opciones: [], texto: '', unica: null };
    if (!b) return { pct: null, opciones: [], texto: 'Retención sin base para calcular el %', unica: null };
    // (10/10/2026) % con 2 decimales (4.275 / 150.000 = 2,85%, no "2,9%")
    const pct = Math.round((r / b) * 10000) / 100;
    const coma = (n) => String(n).replace('.', ',');
    const pesos = (n) => '$ ' + Math.round(n).toLocaleString('es-CO');
    const ops = RETENCIONES.filter((t) => t.pct != null && Math.abs(t.pct - pct) <= 0.02);
    const fmt = (t) => t.nombre + ' ' + coma(t.pct) + '% · cuenta ' + t.cuenta;
    if (ops.length === 1) return { pct, opciones: ops, texto: fmt(ops[0]), unica: ops[0] };
    if (ops.length > 1) return { pct, opciones: ops, texto: coma(pct) + '%: elegir entre ' + ops.map(fmt).join(' / '), unica: null };
    // (10/10/2026) retencion de la tabla + ReteICA en la misma cifra (caso real: 4.275 sobre 150.000 = Compras 2,5% $ 3.750 +
    // ReteICA 3,5 por mil $ 525). La tarifa de ReteICA depende del municipio y no esta en la tabla: solo se PROPONE (por revisar).
    const combos = RETENCIONES.filter((t) => t.pct != null && t.pct < pct).map((t) => ({ t, ica: Math.round((pct - t.pct) * 100) / 10 }))
      .filter((x) => x.ica >= 1 && x.ica <= 14 && Math.abs(x.ica * 2 - Math.round(x.ica * 2)) < 0.011)   // tarifas de ICA en por mil, de a medio punto
      .sort((a, b) => b.t.pct - a.t.pct).slice(0, 3);
    if (combos.length) return { pct, opciones: combos.map((x) => x.t), unica: null,
      texto: coma(pct) + '%: posible ' + combos.map((x) => x.t.nombre + ' ' + coma(x.t.pct) + '% (' + pesos(b * x.t.pct / 100) + ', cuenta ' + x.t.cuenta + ') + ReteICA ' + coma(x.ica) + ' por mil (' + pesos(b * x.ica / 1000) + ')').join(' o ') + ' — confirmar' };
    return { pct, opciones: [], texto: coma(pct) + '% no está en la tabla de retenciones (¿ReteICA?)', unica: null };
  }

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
  // almacenes de 123 Wok, Casa de Nadie y Sin Par (los de Rocoto/Arrebatao se llaman ROCOTO..., MALANGA..., PLANTA PRODUCCION ROCOTO)
  const ALMACENES_OTRAS = ['OVIEDO', 'LAURELES', 'INTERPLAZA', 'TESORO', 'CENTRO DE PRODUCCION', 'CASA DE NADIE', 'SINPAR', 'SIN PAR'];
  const esRocotoArrebatao = (v) => !/^FC\s*\./i.test(String((v && v.INGRESO) || '').trim()) && !ALMACENES_OTRAS.includes(norm(v && v['Almacén']));

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
    const informeCargado = !!(informe && informe.length);
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
    const dianPorDoc = new Map(); for (const d of dian || []) (dianPorDoc.get(d.doc) || dianPorDoc.set(d.doc, []).get(d.doc)).push(d);
    // la factura de la DIAN de este documento: por numero; si hay varias con ese numero, la del proveedor de nombre parecido
    const vacias = new Set(['S', 'A', 'SAS', 'SA', 'LTDA', 'Y', 'CIA', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'E', 'BIC', 'EN', 'C']);
    const toks = (s) => norm(s).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter((t) => t && !vacias.has(t));
    const parecido = (a, b) => { const ta = new Set(toks(a)), tb = toks(b); return ta.size && tb.length ? tb.filter((t) => ta.has(t)).length / Math.max(ta.size, tb.length) : 0; };
    const facturaDian = (suDoc, proveedor) => { let l = dianPorDoc.get(alnum(suDoc)) || []; if (l.length > 1) l = l.filter((d) => parecido(d.emisor, proveedor) >= 0.5); return l.length === 1 ? l[0] : null; };
    // (10/10/2026) VALORES POR ARTICULO (pedido del usuario: "a cada articulo"; la retencion se deja a un lado).
    //  - Base de cada articulo = cantidad x precio de SU linea en la factura (precio_historial, que el agente guarda al ingresar:
    //    precio ANTES de impuestos; verificado: la suma da la base de la factura). Se une al pedido por el codigo del articulo.
    //  - Impuestos de cada articulo: la factura solo trae el total de impuestos. Si la factura tiene UNA sola tarifa (0%, 19%, 5% u
    //    8%: impuestos / base), impuesto = base x tarifa. Si mezcla tarifas no se adivina cual lleva IVA: queda pendiente.
    //  - Con el informe de articulos de Hiopos (trae el total CON impuesto de cada linea): base = total / (1 + tarifa unica).
    //  - Neto = base + impuestos. Totales de la factura: los de la DIAN; si no esta en la DIAN, los de Hiopos.
    const preciosPorCufe = new Map(); for (const p of W.precios || []) if (p.factura_cufe) (preciosPorCufe.get(p.factura_cufe) || preciosPorCufe.set(p.factura_cufe, []).get(p.factura_cufe)).push(p);
    const TARIFAS = [0.19, 0.05, 0.08];
    const r0 = (n) => Math.round(n);
    function totalesFactura(v, fd) {
      const signo = (Number(v.Neto) || 0) < 0 ? -1 : 1;
      if (fd) return { base: Math.abs(fd.base), impuestos: Math.abs(fd.impuestos), signo, fuente: 'DIAN' };
      const b = Math.abs(Number(v.Base) || 0), i = Math.abs(Number(v.Impuestos) || 0);
      return b || i ? { base: b, impuestos: i, signo, fuente: 'Hiopos' } : null;
    }
    // tarifa unica de la factura (0 si no tiene impuestos), o null si mezcla tarifas
    function tarifaUnica(t) {
      if (!t) return null;
      if (!t.impuestos) return 0;
      if (!t.base) return null;
      // tiene que calzar al peso (redondeos: hasta $2 o 0,05% de la base), no "mas o menos": 4,75% NO es 5% (es IVA mezclado)
      const s = TARIFAS.find((x) => Math.abs(t.impuestos - t.base * x) <= Math.max(2, t.base * 0.0005));
      return s == null ? null : s;
    }

    const filas = [], revisar = [], sinHomologar = [];
    let docsConArticulos = 0, docsSinArticulos = 0, lineasConValor = 0;
    // (10/10/2026) SOLO ROCOTO Y ARREBATAO (pedido del usuario): 123 Wok, Casa de Nadie y Sin Par siguen como estaban (no entran a
    // la hoja contable). Se reconocen por su serie de centro de costo (FC.COCINA, FC.BAR...) o por su almacen.
    const docsAlcance = (documentos || []).filter((x) => esRocotoArrebatao(x.v));
    for (const x of docsAlcance) {
      const v = x.v, ingreso = v.INGRESO || '', clave = claveIngreso(ingreso), suDoc = String(v['Su Doc'] || '');
      const base = { fecha: v['Fecha Doc'] || null, proveedor: v.Contacto || '', factura: suDoc, ingreso, almacen: v['Almacén'] || '' };
      const obsDoc = [];
      const fd = dianDocs ? facturaDian(suDoc, base.proveedor) : null;
      const enDian = dianDocs ? !!fd : null;
      if (dianDocs && !enDian) obsDoc.push('Factura de la DIAN no encontrada');
      const tot = totalesFactura(v, fd), tarifa = tarifaUnica(tot), signo = tot ? tot.signo : 1;
      // la factura de la web de este ingreso (por el N° de ingreso; si no, por el numero de factura si es UNA sola)
      let cufe = clave ? cufePorIngreso.get(clave) : null, variasWeb = false;
      if (!cufe) { const s = cufesPorDoc.get(alnum(suDoc)); if (s && s.size === 1) cufe = [...s][0]; else if (s && s.size > 1) variasWeb = true; }
      // 1) informe de articulos de Hiopos (lo que realmente entro al ERP en ese ingreso)
      let lineas = [], fuente = '', pedidoTxt = '', centro = '';
      // el mismo numero de ingreso en dos almacenes: tiene que coincidir el almacen (si no, no se elige)
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
        lineas = delInforme.map((l) => {
          const neto = Math.abs(Number(l.total));   // el signo (nota credito) se pone al final, igual para todas las fuentes
          const b = isFinite(neto) && tarifa != null ? r0(neto / (1 + tarifa)) : null;
          return { articulo: l.articulo, familia: l.familia, cantidad: l.cantidad, almacen: l.almacen || base.almacen, devolucion: /ABONO|DEVOL/i.test(l.tipoDoc),
            base: b, impuestos: b != null ? r0(neto) - b : null, neto: isFinite(neto) ? r0(neto) : null, fuenteVal: 'informe de Hiopos (total con impuesto de la línea)' };
        });
      } else {
        // 2) pedido de la web amarrado a la factura
        if (variasWeb) obsDoc.push('Varias facturas de la web con ese número: no se eligió ninguna');
        const peds = cufe ? (pedidosPorCufe.get(cufe) || []) : [];
        if (peds.length) {
          fuente = 'Pedido de la web';
          pedidoTxt = peds.map((p) => p.numero).join(', ');
          centro = [...new Set(peds.map((p) => p.centro_costo).filter(Boolean))].join(', ');
          if (peds.length > 1) obsDoc.push('Factura con ' + peds.length + ' pedidos amarrados (' + pedidoTxt + ')');
          // lineas de la factura (precio antes de impuestos) por codigo de articulo
          const precs = preciosPorCufe.get(cufe) || [], porCodigo = new Map(), usadas = new Set();
          precs.forEach((p, k) => { const c = norm(p.codigo); if (c) (porCodigo.get(c) || porCodigo.set(c, []).get(c)).push(k); });
          for (const p of peds) for (const l of lineasPorPedido.get(p.id) || []) {
            const ks = (porCodigo.get(norm(l.codigo)) || []).filter((k) => !usadas.has(k));
            ks.forEach((k) => usadas.add(k));
            const b = ks.length ? r0(ks.reduce((s, k) => s + (Number(precs[k].cantidad) || 0) * (Number(precs[k].precio) || 0), 0)) : null;
            lineas.push({ articulo: l.insumo, familia: famCod.get(norm(l.codigo)) || l.subfamilia || '', cantidad: ks.length ? ks.reduce((s, k) => s + (Number(precs[k].cantidad) || 0), 0) : l.cantidad,
              almacen: base.almacen, pedido: p.numero, base: b, fuenteVal: ks.length ? 'línea de la factura (precio antes de impuestos)' : '',
              faltaEnFactura: precs.length > 0 && !ks.length });
          }
          // lineas de la factura que no estan en el pedido: van como filas aparte (asi la suma cuadra con la factura)
          precs.forEach((p, k) => {
            if (usadas.has(k)) return;
            lineas.push({ articulo: p.articulo_texto || '(sin descripción)', familia: famCod.get(norm(p.codigo)) || '', cantidad: Number(p.cantidad) || null, almacen: base.almacen,
              pedido: '', base: r0((Number(p.cantidad) || 0) * (Number(p.precio) || 0)), fuenteVal: 'línea de la factura (precio antes de impuestos)', extraFactura: true });
          });
          if (!lineas.length) obsDoc.push('Pedido sin artículos');
          if (lineas.length && !precs.length) obsDoc.push('La factura no tiene el detalle de precios en la web: valores por artículo pendientes (carga el informe de artículos de Hiopos)');
          lineas.forEach((l) => { if (l.base != null) { l.impuestos = tarifa != null ? r0(l.base * tarifa) : null; l.neto = l.impuestos != null ? l.base + l.impuestos : null; } });
        } else obsDoc.push(informeCargado ? 'Pedido no encontrado: no hay pedido en la web y el ingreso no está en el informe de artículos de Hiopos que se cargó' : 'Pedido no encontrado en la web: carga el informe de artículos de Hiopos ("FACTURAS DE COMPRA") para traer sus artículos');
      }
      if (!ingreso) obsDoc.push('Ingreso de Hiopos vacío');
      // cuadre con la factura (sin repartir diferencias: solo se avisa)
      const conValor = lineas.filter((l) => l.base != null);
      if (tot && conValor.length) {
        const sb = conValor.reduce((s, l) => s + l.base, 0);
        if (Math.abs(sb - tot.base) > 1 && conValor.length === lineas.length) obsDoc.push('Los artículos suman base $ ' + sb.toLocaleString('es-CO') + ' y la factura $ ' + r0(tot.base).toLocaleString('es-CO') + ' (' + tot.fuente + ')');
        if (tarifa == null && tot.impuestos) obsDoc.push('La factura mezcla tarifas de impuesto (impuestos $ ' + r0(tot.impuestos).toLocaleString('es-CO') + '): impuestos por artículo pendientes');
      }
      if (lineas.length) docsConArticulos++; else docsSinArticulos++;
      const enDianTxt = dianDocs ? (enDian ? 'Sí (sin detalle de artículos)' : 'No encontrada') : 'No se cargó el reporte';
      if (!lineas.length) {
        const obs = obsDoc.join('; ');
        filas.push({ ok: false, obs, celdas: celdasDe({ fecha: base.fecha, proveedor: base.proveedor, factura: base.factura, ingreso, obs }),
          soporte: [ingreso, base.factura, base.proveedor, base.almacen, '', null, null, fuente || '—', pedidoTxt, centro, '', enDianTxt, ''] });
        revisar.push({ fila: x.fila, ingreso, factura: base.factura, proveedor: base.proveedor, articulo: '', motivo: obs });
        continue;
      }
      lineas.forEach((l, i) => {
        const h = homologar(l.articulo, l.familia, l.almacen, cat, R);
        const obs = [...(i === 0 ? obsDoc : obsDoc.filter((o) => !/^(Los artículos suman|La factura mezcla)/.test(o)))];
        if (!h.ok && h.obs) obs.push(h.obs);
        if (l.devolucion) obs.push('Devolución (abono factura compra)');
        if (l.extraFactura) obs.push('Línea de la factura que no está en el pedido');
        if (l.faltaEnFactura) obs.push('No está en la factura (no llegó o se facturó con otro código)');
        const c = h.c || {};
        const familia = c.familia || '';
        if (!h.ok) sinHomologar.push({ articulo: l.articulo, familia: l.familia, ingreso });
        if (l.base != null) lineasConValor++;
        const sg = (n) => (n == null ? null : (n ? signo * n : 0));
        filas.push({ ok: h.ok && !obsDoc.length, obs: obs.join('; '),
          celdas: celdasDe({ familia, fecha: base.fecha, proveedor: base.proveedor, factura: base.factura, ingreso, articulo: l.articulo,
            base: sg(l.base), impuestos: sg(l.impuestos), neto: sg(l.neto),
            referencia: c.referencia || '', subfamilia: c.subfamilia || '', cuenta: c.cuenta || '', devolucion: c.devolucion || '', grupo: c.grupo || '', obs: obs.join('; ') }),
          soporte: [ingreso, base.factura, base.proveedor, l.almacen, l.articulo, l.cantidad, sg(l.neto), fuente, l.pedido || pedidoTxt, centro, h.regla || '—', enDianTxt,
            l.base != null ? l.fuenteVal + (l.impuestos != null ? '; impuesto ' + (tarifa ? Math.round(tarifa * 100) + '%' : '0%') + ' (tarifa única de la factura, ' + (tot ? tot.fuente : '') + ')' : '') : ''] });
        if (obs.length) revisar.push({ fila: x.fila, ingreso, factura: base.factura, proveedor: base.proveedor, articulo: l.articulo, motivo: obs.join('; ') });
      });
    }
    const conCuenta = filas.filter((f) => f.celdas[IX['CUENTA CONTAB']]).length;
    return { filas, revisar, sinHomologar, resumen: { lineasConValor, documentos: docsAlcance.length, otrasMarcas: (documentos || []).length - docsAlcance.length, docsConArticulos, docsSinArticulos, lineas: filas.length, conCuenta, sinCuenta: filas.length - conCuenta, listas: filas.filter((f) => f.ok && !f.obs).length } };
  }

  // ---- hojas del Excel (ExcelJS) ----
  const fechaExcel = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  function hoja(wb, nombre, titulos, filas, anchos, color) {
    const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(titulos);
    const enc = ws.getRow(1); enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    enc.eachCell((cel) => { cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color || 'FF1E3A8A' } }; });
    for (const f of filas) ws.addRow(f);
    titulos.forEach((t, i) => { const col = ws.getColumn(i + 1); col.width = anchos[i] || 14; if (/^Fecha$/.test(t)) col.numFmt = 'dd/mm/yyyy'; if (/^(Valor total|Cantidad|Neto del artículo)$/.test(t)) col.numFmt = '#,##0.##'; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titulos.length } };
    return ws;
  }
  // agrega "Contabilidad" (la plantilla, 12 columnas), "Soporte contable" (trazabilidad) y "Por revisar contable"
  function agregarHojas(wb, r) {
    const conFecha = (c) => c.map((x, i) => (i === IX.Fecha ? fechaExcel(x) : x));
    const ANCHO = { Familia: 22, Fecha: 12, Proveedor: 36, Factura: 16, Ingreso: 18, ARTICULO: 42, Base: 14, Impuestos: 13, Neto: 14, REFERENCIA: 13, SUBFAMILIA: 22, 'CUENTA CONTAB': 14, DEVOLUCION: 14, 'GRUPO CUENTA': 26, Observacion: 50 };
    const ws = hoja(wb, 'Contabilidad', COLUMNAS, r.filas.map((f) => conFecha(f.celdas)), COLUMNAS.map((c) => ANCHO[c]), 'FF1E3A8A');
    // texto en las celdas de codigos (no numeros): las cuentas y referencias se conservan tal cual
    ['REFERENCIA', 'CUENTA CONTAB', 'DEVOLUCION', 'Factura', 'Ingreso'].forEach((t) => { ws.getColumn(COLUMNAS.indexOf(t) + 1).numFmt = '@'; });
    ['Base', 'Impuestos', 'Neto'].forEach((t) => { ws.getColumn(COLUMNAS.indexOf(t) + 1).numFmt = '#,##0'; });
    r.filas.forEach((f, i) => { if (f.obs) ws.getRow(i + 2).getCell(IX.Observacion + 1).font = { color: { argb: 'FFB91C1C' } }; });
    hoja(wb, 'Soporte contable', SOPORTE, r.filas.map((f) => f.soporte), [18, 16, 34, 18, 40, 10, 14, 28, 16, 18, 44, 24, 70], 'FF0F766E');
    hoja(wb, 'Por revisar contable', ['Fila del archivo', 'Ingreso', 'Factura', 'Proveedor', 'ARTICULO', 'Motivo'],
      r.revisar.map((x) => [x.fila, x.ingreso, x.factura, x.proveedor, x.articulo, x.motivo]), [10, 18, 16, 34, 40, 70], 'FFB45309');
  }

  return { COLUMNAS, IX, SOPORTE, SEDES, ALMACENES_OTRAS, esRocotoArrebatao, RETENCIONES, tipoRetencion, norm, alnum, claveIngreso, esSede, leerInformeArticulos, indexarCatalogo, indexarReglas, homologar, proponerReglas, armar, agregarHojas };
});
