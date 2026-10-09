// ============================================================
//  organizador-hiopos.js  -  ORGANIZADOR DEL EXCEL DE "FACTURAS DE COMPRA" DE HIOPOS  (09/10/2026)   (Admin > Organizador Hiopos)
//  Lee el Excel que se descarga de Hiopos (hoja "Documentos": Serie / Numero, Fecha Doc, Su Doc, Hora, Contacto, Estado,
//  Almacen, Empleado, Base, Impuestos, Retenciones, Neto, Procesado, Pendiente) y lo deja como las planillas que se arman
//  a mano: 16 columnas en este orden: Fecha Doc, Su Doc, Hora, Contacto, Estado, Almacen, Empleado, Base, Impuestos,
//  Retenciones, Neto, Procesado, Pendiente, INGRESO (= Serie / Numero), DETALLE (centro de costo segun la serie) y Nota.
//
//  Reglas (decididas por el usuario el 09/10/2026; Hiopos no trae ningun dato de "cuenta de cobro" ni de "contado"):
//   - CUENTA DE COBRO: el Contacto esta en la lista "cobra con cuenta de cobro" (Admin). Queda en la hoja Documentos con
//     la nota "CUENTA DE COBRO" (sin repetirla si ya estaba).
//   - CAJA MENOR: el Contacto esta en la lista "se paga por caja menor". Va a la hoja "Caja menor" con "PAGADO CAJA MENOR".
//   - Si cumple las dos: va a Caja menor (PRIORIDAD) con las dos notas y queda en la lista de revision.
//   Cada documento queda en UNA sola hoja; los repetidos dentro del archivo se cuentan una vez y se avisan.
//  Columnas por ENCABEZADO (no por posicion), sin importar mayusculas, espacios ni tildes. Nada se inventa: lo que no
//  viene queda vacio y se avisa. Logica PURA (sin red, sin IA): se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrganizadorHiopos = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLUMNAS = ['Fecha Doc', 'Su Doc', 'Hora', 'Contacto', 'Estado', 'Almacén', 'Empleado', 'Base', 'Impuestos', 'Retenciones', 'Neto', 'Procesado', 'Pendiente', 'INGRESO', 'DETALLE', 'Nota'];
  const NUMERICAS = ['Base', 'Impuestos', 'Retenciones', 'Neto', 'Pendiente'];
  const REQUERIDAS = ['Fecha Doc', 'Su Doc', 'Contacto', 'Neto'];
  const LEYENDA_CC = 'CUENTA DE COBRO', LEYENDA_CM = 'PAGADO CAJA MENOR';
  // serie del ERP -> nombre del centro de costo (DETALLE), con los nombres que pidio el usuario (09/10/2026; los mismos de centro_costo_serie)
  // (10/10/2026) Rocoto y Arrebatao: el centro de costo NO viene de la serie del ERP (es FCRC/FCAR para todo).
  // Se elige al amarrar y se guarda en pedidos.centro_costo; el organizador lo lee de ahi via completarDesdeWeb.
  const DETALLE_SERIE = { 'FC.COCINA': 'COCINA', 'FC.BAR': 'BAR', 'FC.ASEO': 'MATERIAL DE ASEO', 'FC.EMPAQUES': 'MATERIAL DE EMPAQUE', 'FC.UTILESYPAPELERIA': 'UTENSILIOS Y PAPELERIA' };

  const plano = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // encabezado del archivo -> columna destino
  // (09/10/2026) "Serie" y "Numero" SEPARADOS no van aqui: leerTabla los junta ("FC.BAR / 1890")
  const ALIAS = { 'serie numero': 'INGRESO', 'serie y numero': 'INGRESO', 'serie numero documento': 'INGRESO', 'ingreso': 'INGRESO', 'n ingreso': 'INGRESO', 'no ingreso': 'INGRESO',
    'detalle': 'DETALLE', 'centro de costo': 'DETALLE', 'centro de costos': 'DETALLE', 'nota': 'Nota', 'notas': 'Nota', 'observacion': 'Nota', 'observaciones': 'Nota' };
  const SOLO_SERIE = ['serie'], SOLO_NUMERO = ['numero', 'num', 'n', 'no', 'numero documento', 'num documento', 'n documento', 'no documento'];
  for (const c of COLUMNAS) ALIAS[plano(c)] = c;
  const columnaDe = (titulo) => ALIAS[plano(titulo)] || null;
  const contactoClave = (t) => plano(t);
  const serieDe = (ingreso) => String(ingreso || '').split('/')[0].replace(/\s+/g, '').toUpperCase();
  const detalleDeSerie = (ingreso) => DETALLE_SERIE[serieDe(ingreso)] || '';

  // ---- valores ----
  function aNumero(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v == null ? '' : v).trim().replace(/\$/g, '').replace(/\s/g, '');
    if (!s) return null;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');        // 1.234.567,89
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');                      // 1,234,567.89
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');                                       // 1234,5
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  // Fecha de Excel (numero de serie) o texto dd/mm/aaaa | aaaa-mm-dd -> 'AAAA-MM-DD' (o null)
  function aFecha(v) {
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    const n = typeof v === 'number' ? v : (/^\d+(\.\d+)?$/.test(String(v || '').trim()) ? Number(v) : null);
    if (n != null && n > 20000 && n < 80000) {
      const d = new Date(Math.round((Math.floor(n) - 25569) * 86400000));
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    const s = String(v == null ? '' : v).trim();
    // solo fechas que existen (31/02 no): se valida con el calendario
    const real = (a, me, d) => { const f = new Date(Date.UTC(+a, +me - 1, +d)); return f.getUTCFullYear() === +a && f.getUTCMonth() === +me - 1 && f.getUTCDate() === +d ? a + '-' + pad(me) + '-' + pad(d) : null; };
    let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (m) return real(m[3], m[2], m[1]);
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return real(m[1], m[2], m[3]);
    return null;
  }
  // Hora de Excel (fraccion del dia) o texto -> 'HH:MM:SS' (o null)
  function aHora(v) {
    let n = typeof v === 'number' ? v : (/^\d*\.\d+$|^0$/.test(String(v || '').trim()) ? Number(v) : null);
    if (n != null) { n = n % 1; const s = Math.round(n * 86400); return pad(Math.floor(s / 3600) % 24) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); }
    const m = String(v == null ? '' : v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return m ? pad(m[1]) + ':' + m[2] + ':' + (m[3] || '00') : null;
  }
  function aBooleano(v) {
    if (typeof v === 'boolean') return v;
    const s = plano(v);
    if (['true', 'verdadero', 'si', '1', 'x'].includes(s)) return true;
    if (['false', 'falso', 'no', '0', ''].includes(s)) return false;
    return null;
  }
  // agrega una leyenda a la nota sin borrar lo que habia ni repetirla
  function agregarLeyenda(nota, leyenda) {
    const n = String(nota == null ? '' : nota).trim();
    if (plano(n).includes(plano(leyenda))) return n;
    return n ? n + ' | ' + leyenda : leyenda;
  }

  // (09/10/2026) CSV que exporta Hiopos ("Documentos (4).csv"): separado por ";", primera columna = n° de fila sin titulo,
  // miles con punto (488.180), fechas dd/mm/aaaa y una fila final de TOTALES. Se lee TODO como texto (sin que una libreria
  // de Excel adivine: "488.180" no es 488,18 ni "07/10/2026" es 10 de julio) y aNumero/aFecha lo convierten. -> aoa
  function leerCsv(texto) {
    const t = String(texto || '').replace(/^﻿/, '');
    const primera = t.split(/\r?\n/, 1)[0] || '';
    const cuenta = (c) => primera.split(c).length - 1;
    const sep = [';', '\t', ','].sort((a, b) => cuenta(b) - cuenta(a))[0];
    const filas = []; let fila = [], campo = '', comillas = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (comillas) {
        if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
        else campo += ch;
      } else if (ch === '"' && campo === '') comillas = true;
      else if (ch === sep) { fila.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
      else campo += ch;
    }
    if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
    return filas.filter((f) => f.some((x) => String(x).trim() !== ''));
  }

  // aoa = filas del Excel (arreglo de arreglos, como XLSX.utils.sheet_to_json(..., {header:1, raw:true}))
  // -> { filaEncabezado, columnas: {COLUMNA: indice}, faltan: [requeridas que no vienen], noUsadas: [titulos], filas, errores, repetidas }
  function leerTabla(aoa) {
    const datos = (aoa || []).map((r) => (Array.isArray(r) ? r : []));
    let fe = -1, mejor = 0;
    for (let i = 0; i < Math.min(datos.length, 15); i++) {
      const n = datos[i].filter((t) => columnaDe(t)).length;
      if (n > mejor) { mejor = n; fe = i; }
    }
    if (fe < 0 || mejor < 4) return { filaEncabezado: -1, columnas: {}, faltan: REQUERIDAS.slice(), noUsadas: [], filas: [], errores: [{ fila: null, motivo: 'No encontré el encabezado de Hiopos (Fecha Doc, Su Doc, Contacto, Neto...). ¿Es el Excel de Facturas de compra?' }], repetidas: [] };
    const columnas = {}, noUsadas = [];
    let colSerie = null, colNumero = null;
    datos[fe].forEach((t, i) => {
      const c = columnaDe(t), p = plano(t);
      if (c && columnas[c] == null) columnas[c] = i;
      else if (!c && SOLO_SERIE.includes(p) && colSerie == null) colSerie = i;
      else if (!c && SOLO_NUMERO.includes(p) && colNumero == null) colNumero = i;
      else if (String(t || '').trim()) noUsadas.push(String(t).trim());
    });
    // de donde sale el INGRESO (el FC de Hiopos): su columna, o "Serie" + "Numero" separados, o nada (se avisa)
    const ingresoDe = columnas.INGRESO != null ? 'columna' : (colSerie != null ? (colNumero != null ? 'serie+numero' : 'serie') : null);
    if (ingresoDe !== 'serie+numero' && colNumero != null) noUsadas.push(String(datos[fe][colNumero]).trim());
    const faltan = REQUERIDAS.filter((c) => columnas[c] == null);
    const filas = [], errores = [], repetidas = [], vistos = new Map();
    let totalArchivo = null;
    for (let i = fe + 1; i < datos.length; i++) {
      const r = datos[i];
      if (!r.some((v) => String(v == null ? '' : v).trim() !== '')) continue;   // fila vacia
      const crudo = (c) => (columnas[c] == null ? '' : r[columnas[c]]);
      const v = {}; const problemas = [];
      for (const c of COLUMNAS) {
        const x = crudo(c);
        if (NUMERICAS.includes(c)) { const n = aNumero(x); if (n == null && String(x == null ? '' : x).trim() !== '') problemas.push(c + ' no es un número ("' + x + '")'); v[c] = n; }
        else if (c === 'Fecha Doc') { const f = aFecha(x); if (!f && String(x || '').trim()) problemas.push('Fecha Doc no es una fecha ("' + x + '")'); v[c] = f; }
        else if (c === 'Hora') v[c] = aHora(x);
        else if (c === 'Procesado') v[c] = aBooleano(x);
        else v[c] = String(x == null ? '' : x).trim();
      }
      if (ingresoDe === 'serie' || ingresoDe === 'serie+numero') {
        const se = String(r[colSerie] == null ? '' : r[colSerie]).trim(), nu = colNumero != null ? String(r[colNumero] == null ? '' : r[colNumero]).trim() : '';
        v.INGRESO = se ? (nu ? se + ' / ' + nu : se) : '';
      }
      // (09/10/2026) fila de TOTALES del final (Hiopos la pone en el CSV): sin fecha, Su Doc ni contacto, pero con Neto. No es un documento.
      if (!v['Su Doc'] && !v['Contacto'] && !v['Fecha Doc'] && !v.INGRESO && v.Neto != null) { totalArchivo = v.Neto; continue; }
      if (!v['Su Doc'] && !v['Contacto']) problemas.push('sin Su Doc ni Contacto');
      if (!v.DETALLE) v.DETALLE = detalleDeSerie(v.INGRESO);
      const fila = { fila: i + 1, v };
      if (problemas.length) { errores.push({ fila: i + 1, motivo: problemas.join('; '), v }); continue; }
      const clave = v.INGRESO ? 'I:' + v.INGRESO.replace(/\s+/g, '').toUpperCase() : 'D:' + [plano(v['Su Doc']), contactoClave(v.Contacto), v.Neto, v['Fecha Doc']].join('|');
      if (vistos.has(clave)) { repetidas.push({ fila: i + 1, igualA: vistos.get(clave), v }); continue; }
      vistos.set(clave, i + 1);
      filas.push(fila);
    }
    return { filaEncabezado: fe + 1, columnas, faltan, noUsadas, filas, errores, repetidas, ingresoDe, totalArchivo };
  }

  // ---- (09/10/2026) BASE, IMPUESTO Y TOTAL contra la FACTURA (reporte de la DIAN) ----
  // El usuario pidio: si la base, el impuesto o el total de Hiopos no son los de la factura, alertar para modificarlos.
  // Fuente: el Excel/CSV que se baja de la DIAN (Prefijo, Folio, Nombre Emisor, IVA, ICA, IC, INC, ..., Total, Grupo).
  // Factura: impuestos = suma de TODAS las columnas de impuestos (no las retenciones); base = total - impuestos.
  // Hiopos: total = Base + Impuestos (el Neto ya descuenta retenciones, que la factura no trae). Notas credito: en valor absoluto.
  // Se tolera 1 peso (redondeos). Calibrado con datos reales (Rocoto, 01-05/10/2026): 28 de 34 iguales al peso.
  const IMPUESTOS_DIAN = ['IVA', 'ICA', 'IC', 'INC', 'Timbre', 'INC Bolsas', 'IN Carbono', 'IN Combustibles', 'IC Datos', 'ICL', 'INPP', 'IBUA', 'ICUI'];
  const TOLERANCIA = 1;
  const PALABRAS_VACIAS = new Set(['s', 'a', 'sas', 'sa', 'ltda', 'y', 'cia', 'de', 'del', 'la', 'el', 'los', 'las', 'e', 'hijos', 'bic', 'en', 'c']);
  const tokens = (s) => plano(s).split(' ').filter((t) => t && !PALABRAS_VACIAS.has(t));
  function parecido(a, b) {
    const ta = new Set(tokens(a)), tb = tokens(b);
    if (!ta.size || !tb.length) return 0;
    return tb.filter((t) => ta.has(t)).length / Math.max(ta.size, tb.length);
  }
  // aoa del reporte de la DIAN -> { registros: [{ doc, emisor, nit, total, impuestos, base, desglose }], error }
  function leerDian(aoa) {
    const datos = (aoa || []).map((r) => (Array.isArray(r) ? r : []));
    let fe = -1;
    for (let i = 0; i < Math.min(datos.length, 15); i++) {
      const hs = datos[i].map(plano);
      if (hs.includes('folio') && hs.includes('total') && (hs.includes('prefijo') || hs.some((h) => /cufe|cude/.test(h)))) { fe = i; break; }
    }
    if (fe < 0) return { registros: [], error: 'No encontré las columnas del reporte de la DIAN (Prefijo, Folio, Total, IVA...). Bájalo de la DIAN en Excel o CSV.' };
    const H = datos[fe].map(plano), col = (n) => H.indexOf(plano(n));
    const cPre = col('Prefijo'), cFol = col('Folio'), cTot = col('Total'), cEmi = col('Nombre Emisor'), cNit = col('NIT Emisor'), cGru = col('Grupo'), cTipo = col('Tipo de documento');
    const cImp = IMPUESTOS_DIAN.map((n) => [n, col(n)]).filter(([, i]) => i >= 0);
    const registros = [];
    for (let i = fe + 1; i < datos.length; i++) {
      const r = datos[i];
      const doc = alnum((cPre >= 0 ? r[cPre] : '') + '' + (r[cFol] == null ? '' : r[cFol]));
      if (!doc) continue;
      if (cGru >= 0 && String(r[cGru] || '').trim() && !/^recib/.test(plano(r[cGru]))) continue;   // solo lo RECIBIDO (compras), no las ventas
      const total = aNumero(r[cTot]); if (total == null) continue;
      const desglose = {}; let impuestos = 0;
      for (const [n, ix] of cImp) { const x = aNumero(r[ix]) || 0; if (x) { desglose[n] = x; impuestos += x; } }
      impuestos = Math.round(impuestos * 100) / 100;
      registros.push({ doc, emisor: String(cEmi >= 0 ? r[cEmi] || '' : '').trim(), nit: String(cNit >= 0 ? r[cNit] || '' : '').replace(/\D/g, ''),
        tipo: String(cTipo >= 0 ? r[cTipo] || '' : '').trim(), total, impuestos, base: Math.round((total - impuestos) * 100) / 100, desglose });
    }
    return { registros, error: registros.length ? null : 'El reporte de la DIAN no trae facturas recibidas.' };
  }
  // filas del Organizador vs registros de la DIAN -> { porFila: Map(fila -> {campos, factura}), comparadas, sinFactura, ambiguas }
  // Se empareja por Su Doc = Prefijo+Folio; si hay varias facturas con ese numero (otro proveedor), por el nombre del proveedor.
  function compararConDian(filas, registros) {
    const por = new Map();
    for (const d of registros || []) (por.get(d.doc) || por.set(d.doc, []).get(d.doc)).push(d);
    const porFila = new Map(); let comparadas = 0, sinFactura = 0, ambiguas = 0;
    for (const x of filas || []) {
      const v = x.v; let l = por.get(alnum(v['Su Doc'])) || [];
      if (l.length > 1) { const p = l.filter((d) => parecido(d.emisor, v.Contacto) >= 0.5); l = p.length ? p : l; }
      if (!l.length) { sinFactura++; continue; }
      if (l.length > 1) { ambiguas++; continue; }
      const f = l[0]; comparadas++;
      const ab = (n) => Math.abs(Number(n) || 0);
      const hB = ab(v.Base), hI = ab(v.Impuestos), hT = Math.round((hB + hI) * 100) / 100;
      const campos = [];
      if (Math.abs(hB - f.base) > TOLERANCIA) campos.push({ campo: 'Base', hiopos: hB, factura: f.base });
      if (Math.abs(hI - f.impuestos) > TOLERANCIA) campos.push({ campo: 'Impuestos', hiopos: hI, factura: f.impuestos });
      if (Math.abs(hT - f.total) > TOLERANCIA) campos.push({ campo: 'Total', hiopos: hT, factura: f.total });
      if (campos.length) porFila.set(x.fila, { campos, factura: f });
    }
    return { porFila, comparadas, sinFactura, ambiguas };
  }
  const pesos = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CO');
  // texto de la alerta: "Base: Hiopos $ 409.103 · factura $ 397.023 | Impuestos: ... (IVA $ 16.668 + IBUA $ 3.888)"
  function textoDiferencia(d) {
    const imp = Object.entries(d.factura.desglose || {}).map(([n, x]) => n + ' ' + pesos(x)).join(' + ');
    return d.campos.map((c) => c.campo + ': Hiopos ' + pesos(c.hiopos) + ' · factura ' + pesos(c.factura) + (c.campo === 'Impuestos' && imp ? ' (' + imp + ')' : '')).join(' | ');
  }

  // (09/10/2026) Lo que el archivo NO trae (INGRESO) se busca en la web: la factura con ese Su Doc que ya tiene N° de ingreso.
  // facturasWeb: [{ sudoc (Su Doc tal como lo guarda el agente: letras y numeros), num_ingreso, centro_costo }]
  // Solo si hay UNA factura con ese Su Doc (si hay dos, no se adivina). El DETALLE sale de la serie; si la serie no lo dice
  // (FCRC/FCAR), del centro de costo elegido al amarrar. Cambia lectura.filas en el sitio. -> { ingresos, detalles }
  const alnum = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  function ingresoLegible(num) {
    const m = String(num || '').trim().toUpperCase().match(/^(FC[A-Z]*(?:\.\s?[A-Z]+)?)\s*\/?\s*(\d+)$/);
    return m ? m[1] + ' / ' + m[2] : String(num || '').trim();
  }
  function completarDesdeWeb(lectura, facturasWeb) {
    const por = new Map();
    for (const f of facturasWeb || []) { const k = alnum(f.sudoc); if (!k || !f.num_ingreso) continue; (por.get(k) || por.set(k, []).get(k)).push(f); }
    let ingresos = 0, detalles = 0;
    for (const x of (lectura && lectura.filas) || []) {
      const v = x.v, l = por.get(alnum(v['Su Doc'])) || [];
      const f = l.length === 1 ? l[0] : null;
      if (!v.INGRESO && f) { v.INGRESO = ingresoLegible(f.num_ingreso); v.ingresoWeb = true; ingresos++; }
      if (!v.DETALLE) {
        const d = detalleDeSerie(v.INGRESO) || (f && f.centro_costo ? detalleDeSerie(f.centro_costo) : '');
        if (d) { v.DETALLE = d; detalles++; }
      }
    }
    return { ingresos, detalles };
  }

  // ---- (09/10/2026) CLASIFICACION POR EVIDENCIA ("PROMPT MAESTRO") ----
  // Tipo de documento (cuenta de cobro o no), SIEMPRE con la evidencia que lo sostiene. Hiopos no trae NIT ni tipo de documento:
  // la identidad sale del NUMERO del documento (Su Doc = Prefijo+Folio de la factura electronica) y, si se conoce, del NIT del
  // proveedor (nombres homologados del Banco: proveedor_nombre_pos / proveedores). El parecido de nombres solo DESEMPATA un
  // mismo numero entre proveedores; nunca confirma por si solo. Nada se marca si no hay evidencia suficiente: va a "Por revisar".
  const TIPO = { CC: 'cuenta_cobro', ORD: 'ordinario', CONOCIDO: 'proveedor_conocido', REVISAR: 'cc_por_revisar', SIN: 'sin_evidencia' };
  const TIPO_TXT = {
    cuenta_cobro: 'Cuenta de cobro identificada', ordinario: 'Documento ordinario identificado',
    proveedor_conocido: 'Proveedor conocido, tipo de documento pendiente', cc_por_revisar: 'Cuenta de cobro por revisar',
    sin_evidencia: 'Sin evidencia del tipo de documento',
  };
  const ORDEN_REVISION = [TIPO.REVISAR, TIPO.CONOCIDO, TIPO.SIN];
  // clave de proveedor sin S.A.S., puntos, "y", "de"... (normaliza, no compara por parecido): "DEL RIO Y DEL MAR S.A.S." = "Del Rio y del Mar SAS"
  const claveProveedor = (s) => tokens(s).join(' ');
  // indicio (NO prueba) de cuenta de cobro: el Su Doc empieza por CC o dice COBRO. Solo manda el documento a revision.
  const indicioCuentaCobro = (suDoc) => /^CC/.test(alnum(suDoc)) || /COBRO/.test(alnum(suDoc));

  // reglas confirmadas (hiopos_contacto_regla) -> Map(contactoClave -> regla activa). Acepta tambien { cuentaCobro:[nombres], cajaMenor:[nombres] }
  function mapaReglas(reglas) {
    const m = new Map();
    if (Array.isArray(reglas)) {
      for (const r of reglas) if (r && r.activo !== false) m.set(r.contacto_norm || contactoClave(r.contacto), r);
    } else if (reglas) {
      for (const c of reglas.cuentaCobro || []) m.set(contactoClave(c), Object.assign(m.get(contactoClave(c)) || {}, { cuenta_cobro: true }));
      for (const c of reglas.cajaMenor || []) m.set(contactoClave(c), Object.assign(m.get(contactoClave(c)) || {}, { caja_menor: true }));
      for (const c of reglas.noCuentaCobro || []) m.set(contactoClave(c), Object.assign(m.get(contactoClave(c)) || {}, { no_cuenta_cobro: true }));
    }
    return m;
  }

  // Evidencia del Banco de Facturas y de la DIAN para clasificar. Todo opcional.
  //  facturas: [{ doc|documento|prefijo+folio, emisor, nit }] (Banco: tabla facturas; DIAN: registros de leerDian)
  //  proveedores: [{ nombre, nit }] (proveedores.razon_social/nombre_comercial, proveedor_nombre_pos.nombre_pos, facturas.emisor)
  function armarEvidencia({ facturas, proveedores } = {}) {
    const porDoc = new Map(), conocidos = new Map();
    for (const f of facturas || []) {
      const docs = new Set([alnum(f.doc), alnum(f.documento), alnum((f.prefijo || '') + (f.folio || ''))].filter(Boolean));
      for (const d of docs) (porDoc.get(d) || porDoc.set(d, []).get(d)).push({ emisor: f.emisor || '', nit: String(f.nit || f.nit_emisor || '').replace(/\D/g, ''), fuente: f.fuente || 'Banco' });
    }
    for (const p of proveedores || []) {
      const k = claveProveedor(p.nombre); if (!k) continue;
      const nit = String(p.nit || '').replace(/\D/g, '');
      const prev = conocidos.get(k);
      conocidos.set(k, prev && prev !== nit ? '' : nit);   // dos NIT con el mismo nombre: se conoce el nombre, no el NIT
    }
    return { porDoc, conocidos };
  }
  // ¿este documento es una factura electronica (de ESTE proveedor)? -> { fuente } | null
  function facturaElectronica(ev, v) {
    const l = (ev && ev.porDoc && ev.porDoc.get(alnum(v['Su Doc']))) || [];
    if (!l.length) return null;
    const nit = ev.conocidos && ev.conocidos.get(claveProveedor(v.Contacto));
    const f = l.find((x) => nit && x.nit && x.nit === nit) || l.find((x) => x.emisor && parecido(x.emisor, v.Contacto) >= 0.5);
    return f ? { fuente: f.fuente + (nit && f.nit === nit ? ' (mismo NIT)' : ' (mismo número y proveedor)') } : null;
  }

  // reglas: ver mapaReglas. evidencia: armarEvidencia(...). correcciones: Map(fila -> { cuenta_cobro?: bool, caja_menor?: bool }) de ESTE archivo.
  // -> { documentos: TODAS las filas, cajaMenor: las de caja menor (tambien estan en documentos), revision: [{fila, v, tipo, motivo, falta}] }
  //    cada fila: { fila, v (Nota final), tipo, evidencia, cuentaCobro, cajaMenor, evidenciaCM }
  function clasificar(filas, reglas, evidencia, correcciones) {
    const R = mapaReglas(reglas), ev = evidencia || {}, cor = correcciones || new Map();
    const documentos = [], caja = [], revision = [];
    for (const f of filas || []) {
      const k = contactoClave(f.v.Contacto), r = R.get(k) || {}, c = cor.get(f.fila) || {};
      const nota = plano(f.v.Nota), suDoc = f.v['Su Doc'];
      const ccNota = nota.includes('cuenta de cobro'), cmNota = nota.includes('caja menor') || /\bcontado\b/.test(nota);
      const fe = facturaElectronica(ev, f.v);
      let tipo, evid = '', motivo = '', falta = '';
      if (c.cuenta_cobro === true) { tipo = TIPO.CC; evid = 'corrección manual en este archivo'; }
      else if (c.cuenta_cobro === false) { tipo = TIPO.ORD; evid = 'corrección manual en este archivo'; }
      else if (r.cuenta_cobro || ccNota) {
        const fuente = ccNota ? 'la nota del documento dice cuenta de cobro' : 'regla confirmada del proveedor';
        if (fe) { tipo = TIPO.REVISAR; motivo = 'Según ' + fuente + ', pero el documento aparece como factura electrónica en ' + fe.fuente; falta = 'Confirmar el tipo de este documento (y revisar la regla del proveedor)'; }
        else { tipo = TIPO.CC; evid = fuente; }
      } else if (fe) { tipo = TIPO.ORD; evid = 'factura electrónica en ' + fe.fuente; }
      else if (r.no_cuenta_cobro) { tipo = TIPO.ORD; evid = 'regla confirmada: el proveedor no cobra con cuenta de cobro'; }
      else if (indicioCuentaCobro(suDoc)) { tipo = TIPO.REVISAR; motivo = 'El Su Doc "' + suDoc + '" tiene forma de cuenta de cobro, pero no hay regla del proveedor ni otra evidencia'; falta = 'Confirmar si es cuenta de cobro (si todos sus documentos lo son, guardar la regla del proveedor)'; }
      else if (ev.conocidos && ev.conocidos.has(claveProveedor(f.v.Contacto))) { tipo = TIPO.CONOCIDO; motivo = 'El proveedor está en el Banco de Facturas, pero no hay evidencia del tipo de este documento'; falta = 'Cargar el reporte de la DIAN (si es factura electrónica queda identificado) o guardar una regla del proveedor'; }
      else { tipo = TIPO.SIN; motivo = 'El proveedor no está en el Banco de Facturas y no hay regla ni factura electrónica para este documento'; falta = 'Cargar el reporte de la DIAN o confirmar el tipo (y guardar la regla si aplica a todo el proveedor)'; }
      const cm = c.caja_menor != null ? !!c.caja_menor : !!(r.caja_menor || cmNota);
      const evidCM = !cm ? '' : (c.caja_menor != null ? 'corrección manual en este archivo' : (r.caja_menor ? 'regla confirmada del proveedor' : 'la nota del documento dice caja menor / contado'));
      const v = Object.assign({}, f.v);
      if (tipo === TIPO.CC) v.Nota = agregarLeyenda(v.Nota, LEYENDA_CC);
      if (cm) v.Nota = agregarLeyenda(v.Nota, LEYENDA_CM);
      const x = { fila: f.fila, v, tipo, evidencia: evid, cuentaCobro: tipo === TIPO.CC, cajaMenor: cm, evidenciaCM: evidCM };
      documentos.push(x);
      if (cm) caja.push(x);
      if (ORDEN_REVISION.includes(tipo)) revision.push({ fila: f.fila, v, tipo, motivo, falta });
    }
    revision.sort((a, b) => ORDEN_REVISION.indexOf(a.tipo) - ORDEN_REVISION.indexOf(b.tipo) || a.fila - b.fila);
    return { documentos, cajaMenor: caja, revision };
  }

  const suma = (l) => Math.round(l.reduce((s, x) => s + (Number(x.v.Neto) || 0), 0) * 100) / 100;
  // Totales sin duplicar: el total general es el de Documentos (la hoja Caja menor es una VISTA de algunos de ellos)
  function resumen(lectura, cl) {
    const cc = cl.documentos.filter((x) => x.cuentaCobro);
    const restantes = cl.documentos.filter((x) => !x.cuentaCobro && !x.cajaMenor);
    const ambos = cl.documentos.filter((x) => x.cuentaCobro && x.cajaMenor);
    const porTipo = {}; for (const t of Object.values(TIPO)) porTipo[t] = cl.documentos.filter((x) => x.tipo === t).length;
    return {
      leidos: lectura.filas.length + lectura.errores.length + lectura.repetidas.length,
      validos: lectura.filas.length,
      cuentasCobro: cc.length, cajaMenor: cl.cajaMenor.length, ambos: ambos.length, restantes: restantes.length,
      revision: cl.revision.length + lectura.repetidas.length, errores: lectura.errores.length, repetidas: lectura.repetidas.length, porTipo,
      sinIngreso: lectura.filas.filter((x) => !x.v.INGRESO).length, sinDetalle: lectura.filas.filter((x) => !x.v.DETALLE).length, ingresoWeb: lectura.filas.filter((x) => x.v.ingresoWeb).length,
      neto: { documentos: suma(cl.documentos), cuentasCobro: suma(cc), cajaMenor: suma(cl.cajaMenor), ambos: suma(ambos), restantes: suma(restantes), total: suma(cl.documentos) },
    };
  }
  // contactos del archivo (para elegir a quien se le aplica cada regla) -> [{ contacto, n, neto }]
  function contactos(filas) {
    const m = new Map();
    for (const f of filas || []) { const k = contactoClave(f.v.Contacto); if (!k) continue; const x = m.get(k) || { contacto: f.v.Contacto, n: 0, neto: 0 }; x.n++; x.neto += Number(f.v.Neto) || 0; m.set(k, x); }
    return [...m.values()].sort((a, b) => a.contacto.localeCompare(b.contacto));
  }
  // la fila lista para el Excel (16 columnas en orden)
  const filaExcel = (v) => COLUMNAS.map((c) => (v[c] == null ? '' : v[c]));

  // ---- Excel final (ExcelJS se pasa: en la web se carga del CDN; en las pruebas, el de node) ----
  const COLOR = { encabezado: 'FF0F766E', cuentaCobro: 'FFFEF3C7', cajaMenor: 'FFDBEAFE', ambos: 'FFEDE9FE', distinto: 'FFFCA5A5' };   // cuenta de cobro amarillo suave, caja menor azul suave, las dos lila
  const fechaExcel = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const horaExcel = (h) => { const m = String(h || '').match(/^(\d{2}):(\d{2}):(\d{2})$/); return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) / 86400 : null; };
  function hojaDocumentos(wb, nombre, lista, dif) {
    const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(COLUMNAS);
    for (const x of lista) {
      const v = x.v;
      const fila = COLUMNAS.map((c) => {
        if (c === 'Fecha Doc') return fechaExcel(v[c]);
        if (c === 'Hora') return horaExcel(v[c]);
        if (c === 'Procesado') return v[c] == null ? null : v[c];
        if (NUMERICAS.includes(c)) return v[c] == null ? null : v[c];
        return v[c] || null;
      });
      const r = ws.addRow(fila);
      const color = x.cuentaCobro && x.cajaMenor ? COLOR.ambos : (x.cajaMenor ? COLOR.cajaMenor : (x.cuentaCobro ? COLOR.cuentaCobro : null));
      if (color) r.eachCell({ includeEmpty: true }, (cel, n) => { if (n <= COLUMNAS.length) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }; });
      // (09/10/2026) lo que no es igual a la factura de la DIAN, en rojo (Total -> Neto, que es lo que Hiopos muestra)
      const d = dif && dif.get(x.fila);
      if (d) for (const c of d.campos) { const col = COLUMNAS.indexOf(c.campo === 'Total' ? 'Neto' : c.campo) + 1; const cel = r.getCell(col); cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.distinto } }; cel.font = { bold: true, color: { argb: 'FF7F1D1D' } }; cel.note = c.campo + ' de la factura: ' + pesos(c.factura); }
    }
    const enc = ws.getRow(1);
    enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    enc.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    enc.height = 22;
    enc.eachCell((cel) => { cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.encabezado } }; cel.border = { bottom: { style: 'thin', color: { argb: 'FF134E4A' } } }; });
    COLUMNAS.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c === 'Fecha Doc') col.numFmt = 'dd/mm/yyyy';
      else if (c === 'Hora') col.numFmt = 'hh:mm:ss';
      else if (NUMERICAS.includes(c)) col.numFmt = '#,##0';
      let ancho = c.length + 4;
      for (const x of lista) { const v = x.v[c]; const l = c === 'Fecha Doc' ? 10 : (c === 'Hora' ? 8 : (NUMERICAS.includes(c) ? String(Math.round(Number(v) || 0)).length + 4 : String(v == null ? '' : v).length)); if (l + 2 > ancho) ancho = l + 2; }
      col.width = Math.min(ancho, 55);
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS.length } };
    return ws;
  }
  // hoja de tabla simple (Por revisar, Clasificacion): encabezado, filtro, primera fila fija, anchos
  function hojaTabla(wb, nombre, titulos, filas, anchos, colorFila) {
    const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(titulos);
    for (const f of filas) {
      const r = ws.addRow(f.celdas);
      r.alignment = { vertical: 'top', wrapText: true };
      const color = colorFila && colorFila(f);
      if (color) r.eachCell({ includeEmpty: true }, (cel, n) => { if (n <= titulos.length) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }; });
    }
    const enc = ws.getRow(1);
    enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    enc.eachCell((cel) => { cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.encabezado } }; });
    titulos.forEach((t, i) => { const col = ws.getColumn(i + 1); col.width = anchos[i] || 14; if (/^(Neto|Base|Impuestos)$/.test(t)) col.numFmt = '#,##0'; if (t === 'Fecha Doc') col.numFmt = 'dd/mm/yyyy'; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titulos.length } };
    return ws;
  }
  // -> el libro (ExcelJS.Workbook): Documentos (todos), Caja menor (vista), Por revisar, Clasificacion (trazabilidad) y Resumen
  function armarLibro(ExcelJS, { lectura, clasificacion, nombreArchivo, ahora, comparacion }) {
    const dif = comparacion && comparacion.porFila;
    const cl = clasificacion;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Banco de Facturas - Organizador Hiopos';
    hojaDocumentos(wb, 'Documentos', cl.documentos, dif);
    hojaDocumentos(wb, 'Caja menor', cl.cajaMenor, dif);

    // Por revisar: lo que no se pudo clasificar con certeza + lo que hay que corregir en Hiopos + repetidos/errores/columnas
    const T = ['Fila del archivo', 'Revisión', 'INGRESO', 'Fecha Doc', 'Su Doc', 'Contacto', 'Neto', 'Motivo', 'Qué falta para resolverlo'];
    const fila = (tipo, x, motivo, falta) => ({ tipo, celdas: [x ? x.fila : '', tipo, (x && x.v.INGRESO) || '', x && x.v['Fecha Doc'] ? fechaExcel(x.v['Fecha Doc']) : null, (x && x.v['Su Doc']) || '', (x && x.v.Contacto) || '', x && x.v.Neto != null ? x.v.Neto : null, motivo, falta] });
    const rev = [
      ...cl.revision.map((x) => fila(TIPO_TXT[x.tipo], x, x.motivo, x.falta)),
      ...cl.documentos.filter((x) => dif && dif.has(x.fila)).map((x) => fila('Valores distintos a la factura', x, textoDiferencia(dif.get(x.fila)), 'Modificar en Hiopos la base, el impuesto o el total')),
      ...lectura.repetidas.map((x) => fila('Repetido en el archivo', x, 'Igual a la fila ' + x.igualA + ' del archivo', 'Nada: se incluyó una sola vez')),
      ...lectura.errores.map((x) => fila('Error de lectura', x.v ? x : { fila: x.fila, v: {} }, x.motivo, 'Corregir el dato en Hiopos y volver a exportar; no se incluyó')),
    ];
    if (lectura.faltan.length) rev.unshift(fila('Columna faltante', null, 'El archivo no trae: ' + lectura.faltan.join(', '), 'Exportar de Hiopos con esas columnas; esas celdas quedaron vacías'));
    if (!lectura.ingresoDe) rev.unshift(fila('Columna faltante', null, 'El archivo no trae Serie / Número (INGRESO)', 'En Hiopos mostrar la columna Serie / Número antes de exportar'));
    const colorRev = { 'Cuenta de cobro por revisar': COLOR.cuentaCobro, 'Valores distintos a la factura': COLOR.distinto, 'Error de lectura': 'FFFEE2E2' };
    hojaTabla(wb, 'Por revisar', T, rev, [10, 30, 18, 12, 16, 36, 14, 60, 50], (f) => colorRev[f.tipo] || null);

    // Clasificacion: cada documento con su tipo y la evidencia (trazabilidad de las reglas aplicadas)
    hojaTabla(wb, 'Clasificación', ['Fila del archivo', 'INGRESO', 'Su Doc', 'Contacto', 'Neto', 'Tipo de documento', 'Evidencia', 'Caja menor', 'Evidencia caja menor'],
      cl.documentos.map((x) => ({ celdas: [x.fila, x.v.INGRESO || '', x.v['Su Doc'] || '', x.v.Contacto || '', x.v.Neto, TIPO_TXT[x.tipo], x.evidencia || '—', x.cajaMenor ? 'Sí' : 'No', x.evidenciaCM || ''] })),
      [10, 18, 16, 36, 14, 32, 46, 11, 40]);

    const R = resumen(lectura, cl);
    const ws = wb.addWorksheet('Resumen');
    ws.columns = [{ width: 58 }, { width: 14 }, { width: 20 }];
    const titulo = (t) => { const r = ws.addRow([t]); r.font = { bold: true, size: 13, color: { argb: COLOR.encabezado } }; };
    titulo('Organizador Hiopos');
    ws.addRow(['Archivo', nombreArchivo || '']);
    ws.addRow(['Organizado el', ahora || '']);
    ws.addRow([]);
    const enc = ws.addRow(['Concepto', 'Documentos', 'Neto']); enc.font = { bold: true };
    const lin = (t, n, v) => { const r = ws.addRow([t, n, v]); r.getCell(3).numFmt = '#,##0'; return r; };
    const pinta = (r, c) => { r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c } }; return r; };
    lin('Total de documentos leídos', R.leidos, null);
    lin('Total general (hoja Documentos, cada documento una sola vez)', R.validos, R.neto.total).font = { bold: true };
    pinta(lin('Cuentas de cobro identificadas', R.cuentasCobro, R.neto.cuentasCobro), COLOR.cuentaCobro);
    pinta(lin('Pagos de contado (también en la hoja Caja menor)', R.cajaMenor, R.neto.cajaMenor), COLOR.cajaMenor);
    pinta(lin('   de ellos, cuenta de cobro y caja menor a la vez', R.ambos, R.neto.ambos), COLOR.ambos);
    lin('Documentos sin cuenta de cobro ni caja menor', R.restantes, R.neto.restantes);
    lin('Pendientes de revisión (hoja Por revisar)', R.revision, null).font = { bold: true };
    lin('Errores de lectura (no se incluyeron)', R.errores, null);
    lin('Repetidos en el archivo (se incluyeron una sola vez)', R.repetidas, null);
    if (lectura.totalArchivo != null) { const d = Math.round((R.neto.total - lectura.totalArchivo) * 100) / 100; lin('Total que trae el archivo de Hiopos (su fila de totales)', null, lectura.totalArchivo); lin(d === 0 ? 'Cuadra con el total general' : 'DIFERENCIA con el total general (revisar errores y repetidos)', null, d).font = { bold: true, color: { argb: d === 0 ? 'FF166534' : 'FFB91C1C' } }; }
    ws.addRow([]); titulo('Clasificación del tipo de documento');
    for (const t of Object.values(TIPO)) lin(TIPO_TXT[t], R.porTipo[t], null);
    ws.addRow([]); titulo('INGRESO, DETALLE y factura');
    lin('INGRESO tomado de la web (el archivo no lo traía)', R.ingresoWeb, null);
    lin('Sin INGRESO (ni en el archivo ni en la web)', R.sinIngreso, null);
    lin('Sin DETALLE (la serie no dice el centro de costo)', R.sinDetalle, null);
    if (comparacion) {
      lin('Comparados con la factura (reporte DIAN)', comparacion.comparadas, null);
      lin('CON VALORES DISTINTOS A LA FACTURA (modificar en Hiopos)', dif.size, null).font = { bold: true, color: { argb: dif.size ? 'FFB91C1C' : 'FF166534' } };
      lin('No están en el reporte de la DIAN', comparacion.sinFactura, null);
    }
    // ---- HOJA CONTABILIDAD (para SIIGO) ----
    // Una fila por documento con: Fecha, Comprobante (INGRESO), Tercero (Contacto), NIT, Centro de Costo,
    // Base, IVA, Total, Cuenta (grupo_cuenta), Detalle.  Si el DETALLE ya trae centro de costo (123 Wok)
    // se usa; si no (Rocoto FCRC / Arrebatao FCAR), se deja en blanco para que contabilidad lo complete.
    const wsC = wb.addWorksheet('Contabilidad', { views: [{ state: 'frozen', ySplit: 1 }] });
    const COL_C = ['Fecha', 'Comprobante (Ingreso ERP)', 'Su Doc (N. Factura)', 'Tercero (Proveedor)', 'Centro de Costo', 'Cuenta Contable', 'Base', 'IVA', 'Total', 'N. Pedido ERP'];
    wsC.addRow(COL_C);
    for (const x of cl.documentos) {
      const v = x.v;
      const base = v.Base != null ? v.Base : null;
      const iva = v.Impuestos != null ? v.Impuestos : null;
      const total = v.Neto != null ? v.Neto : null;
      const centro = v.DETALLE || detalleDeSerie(v.INGRESO) || '';
      wsC.addRow([v['Fecha Doc'] ? fechaExcel(v['Fecha Doc']) : null, v.INGRESO || '', v['Su Doc'] || '', v.Contacto || '', centro, '', base, iva, total, '']);
    }
    const encC = wsC.getRow(1);
    encC.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    encC.eachCell((cel) => { cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }; });
    COL_C.forEach((c, i) => {
      const col = wsC.getColumn(i + 1);
      if (/^(Base|IVA|Total)$/.test(c)) col.numFmt = '#,##0';
      if (c === 'Fecha') col.numFmt = 'dd/mm/yyyy';
      col.width = Math.max(c.length + 2, 18);
    });
    wsC.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COL_C.length } };
    return wb;
  }

  return { COLUMNAS, NUMERICAS, REQUERIDAS, LEYENDA_CC, LEYENDA_CM, DETALLE_SERIE, COLOR, plano, columnaDe, contactoClave, serieDe, detalleDeSerie,
    aNumero, aFecha, aHora, aBooleano, agregarLeyenda, leerCsv, leerTabla, completarDesdeWeb, ingresoLegible, leerDian, compararConDian, textoDiferencia, IMPUESTOS_DIAN, TIPO, TIPO_TXT, claveProveedor, indicioCuentaCobro, mapaReglas, armarEvidencia, facturaElectronica, clasificar, resumen, contactos, filaExcel, armarLibro };
});
