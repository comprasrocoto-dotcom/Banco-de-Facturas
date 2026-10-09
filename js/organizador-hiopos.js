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
  // serie del ERP -> nombre del centro de costo (DETALLE), como en las planillas reales (FC.ASEO = ELEMENTOS DE ASEO Y CAFETERIA)
  const DETALLE_SERIE = { 'FC.COCINA': 'COCINA', 'FC.BAR': 'BAR', 'FC.ASEO': 'ELEMENTOS DE ASEO Y CAFETERIA', 'FC.EMPAQUES': 'EMPAQUES', 'FC.UTILESYPAPELERIA': 'UTILES Y PAPELERIA' };

  const plano = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // encabezado del archivo -> columna destino
  const ALIAS = { 'serie numero': 'INGRESO', 'serie': 'INGRESO', 'ingreso': 'INGRESO', 'detalle': 'DETALLE', 'nota': 'Nota', 'notas': 'Nota', 'observacion': 'Nota', 'observaciones': 'Nota' };
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
    datos[fe].forEach((t, i) => { const c = columnaDe(t); if (c && columnas[c] == null) columnas[c] = i; else if (String(t || '').trim()) noUsadas.push(String(t).trim()); });
    const faltan = REQUERIDAS.filter((c) => columnas[c] == null);
    const filas = [], errores = [], repetidas = [], vistos = new Map();
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
      if (!v['Su Doc'] && !v['Contacto']) problemas.push('sin Su Doc ni Contacto');
      if (!v.DETALLE) v.DETALLE = detalleDeSerie(v.INGRESO);
      const fila = { fila: i + 1, v };
      if (problemas.length) { errores.push({ fila: i + 1, motivo: problemas.join('; '), v }); continue; }
      const clave = v.INGRESO ? 'I:' + v.INGRESO.replace(/\s+/g, '').toUpperCase() : 'D:' + [plano(v['Su Doc']), contactoClave(v.Contacto), v.Neto, v['Fecha Doc']].join('|');
      if (vistos.has(clave)) { repetidas.push({ fila: i + 1, igualA: vistos.get(clave), v }); continue; }
      vistos.set(clave, i + 1);
      filas.push(fila);
    }
    return { filaEncabezado: fe + 1, columnas, faltan, noUsadas, filas, errores, repetidas };
  }

  // reglas: { cuentaCobro: [contactos], cajaMenor: [contactos] } (nombres tal cual; se comparan sin tildes/mayusculas)
  // -> { documentos: [fila], cajaMenor: [fila], revision: [{fila, motivo}] }   (cada fila: { fila, v (con Nota final), cuentaCobro, cajaMenor })
  function clasificar(filas, reglas) {
    const cc = new Set(((reglas && reglas.cuentaCobro) || []).map(contactoClave));
    const cm = new Set(((reglas && reglas.cajaMenor) || []).map(contactoClave));
    const documentos = [], caja = [], revision = [];
    for (const f of filas || []) {
      const k = contactoClave(f.v.Contacto);
      const esCC = cc.has(k), esCM = cm.has(k);
      const v = Object.assign({}, f.v);
      if (esCC) v.Nota = agregarLeyenda(v.Nota, LEYENDA_CC);
      if (esCM) v.Nota = agregarLeyenda(v.Nota, LEYENDA_CM);
      const x = { fila: f.fila, v, cuentaCobro: esCC, cajaMenor: esCM };
      if (esCM) caja.push(x); else documentos.push(x);
      if (esCC && esCM) revision.push({ fila: f.fila, v, motivo: 'El proveedor está en las dos listas (cuenta de cobro y caja menor): va en Caja menor (prioridad) con las dos notas' });
    }
    return { documentos, cajaMenor: caja, revision };
  }

  const suma = (l) => Math.round(l.reduce((s, x) => s + (Number(x.v.Neto) || 0), 0) * 100) / 100;
  function resumen(lectura, cl) {
    const cc = cl.documentos.filter((x) => x.cuentaCobro);
    const restantes = cl.documentos.filter((x) => !x.cuentaCobro);
    return {
      leidos: lectura.filas.length + lectura.errores.length + lectura.repetidas.length,
      validos: lectura.filas.length,
      cuentasCobro: cc.length, cajaMenor: cl.cajaMenor.length, restantes: restantes.length,
      revision: cl.revision.length + lectura.repetidas.length, errores: lectura.errores.length, repetidas: lectura.repetidas.length,
      neto: { documentos: suma(cl.documentos), cuentasCobro: suma(cc), cajaMenor: suma(cl.cajaMenor), restantes: suma(restantes), total: suma(cl.documentos) + suma(cl.cajaMenor) },
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
  const COLOR = { encabezado: 'FF0F766E', cuentaCobro: 'FFFEF3C7', cajaMenor: 'FFDBEAFE', ambos: 'FFEDE9FE' };
  const fechaExcel = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const horaExcel = (h) => { const m = String(h || '').match(/^(\d{2}):(\d{2}):(\d{2})$/); return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) / 86400 : null; };
  function hojaDocumentos(wb, nombre, lista) {
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
  // -> el libro (ExcelJS.Workbook) con Documentos, Caja menor y Resumen
  function armarLibro(ExcelJS, { lectura, clasificacion, nombreArchivo, ahora }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Banco de Facturas - Organizador Hiopos';
    hojaDocumentos(wb, 'Documentos', clasificacion.documentos);
    hojaDocumentos(wb, 'Caja menor', clasificacion.cajaMenor);
    const R = resumen(lectura, clasificacion);
    const ws = wb.addWorksheet('Resumen');
    ws.columns = [{ width: 46 }, { width: 18 }, { width: 22 }, { width: 46 }];
    const titulo = (t) => { const r = ws.addRow([t]); r.font = { bold: true, size: 13, color: { argb: COLOR.encabezado } }; };
    titulo('Organizador Hiopos');
    ws.addRow(['Archivo', nombreArchivo || '']);
    ws.addRow(['Organizado el', ahora || '']);
    ws.addRow([]);
    const enc = ws.addRow(['Concepto', 'Documentos', 'Neto']); enc.font = { bold: true };
    const lin = (t, n, v) => { const r = ws.addRow([t, n, v]); r.getCell(3).numFmt = '#,##0'; return r; };
    lin('Total de documentos leídos', R.leidos, null);
    lin('Cuentas de cobro (hoja Documentos)', R.cuentasCobro, R.neto.cuentasCobro).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.cuentaCobro } };
    lin('Pagos de contado (hoja Caja menor)', R.cajaMenor, R.neto.cajaMenor).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.cajaMenor } };
    lin('Documentos restantes', R.restantes, R.neto.restantes);
    lin('Total organizado (Documentos + Caja menor, sin repetir)', R.validos, R.neto.total).font = { bold: true };
    lin('Requieren revisión', R.revision, null);
    lin('Errores de lectura (no se incluyeron)', R.errores, null);
    lin('Repetidos en el archivo (se incluyeron una sola vez)', R.repetidas, null);
    const det = [
      ...clasificacion.revision.map((x) => ['Revisión', x.fila, x.v['Su Doc'] + ' · ' + x.v.Contacto, x.motivo]),
      ...lectura.repetidas.map((x) => ['Repetido', x.fila, (x.v['Su Doc'] || '') + ' · ' + (x.v.Contacto || ''), 'igual a la fila ' + x.igualA + ' del archivo']),
      ...lectura.errores.map((x) => ['Error de lectura', x.fila, ((x.v && x.v['Su Doc']) || '') + ' · ' + ((x.v && x.v.Contacto) || ''), x.motivo]),
    ];
    if (lectura.faltan.length) det.unshift(['Columna faltante', '', lectura.faltan.join(', '), 'no viene en el archivo: esas celdas quedan vacías']);
    if (det.length) {
      ws.addRow([]); titulo('Para revisar');
      const e2 = ws.addRow(['Tipo', 'Fila del archivo', 'Documento', 'Motivo']); e2.font = { bold: true };
      for (const d of det) ws.addRow(d).getCell(4).alignment = { wrapText: true };
    }
    return wb;
  }

  return { COLUMNAS, NUMERICAS, REQUERIDAS, LEYENDA_CC, LEYENDA_CM, DETALLE_SERIE, COLOR, plano, columnaDe, contactoClave, serieDe, detalleDeSerie,
    aNumero, aFecha, aHora, aBooleano, agregarLeyenda, leerTabla, clasificar, resumen, contactos, filaExcel, armarLibro };
});
