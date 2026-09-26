// ============================================================
//  exportar.js  -  DESCARGAR LO QUE SE VE EN EXCEL O CSV  (26/09/2026)
//  Arma la tabla (encabezados + filas) a partir de la lista que la pantalla YA muestra (con sus filtros y busqueda), la convierte a CSV o a libro de Excel
//  y arma el nombre del archivo. Logica pura (sin red ni DOM; XLSX se inyecta): la usa js/exportar-ui.js y se prueba con node.
//  Como parte de lo que ya ve el usuario (las politicas de la base ya filtran por sede), el archivo nunca trae mas de lo que la persona puede ver.
//  CSV: separador ";" (Excel en espanol), UTF-8 con BOM (tildes bien), decimales con coma, saltos de linea a espacio.
//  Celdas de texto que empiezan con = + @ (o - sin ser numero) llevan un apostrofo delante: un CSV no ejecuta formulas al abrirse en Excel.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Exportar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEP = ';';

  // columnas = [{ t: 'Titulo', v: (fila) => valor }] ; filas = [..] -> [[titulos], [valores]...]. Un valor que falla queda vacio (una fila rara no tumba la descarga).
  function matriz(columnas, filas) {
    const cols = columnas || [];
    const cab = cols.map((c) => c.t);
    const cuerpo = (filas || []).map((f) => cols.map((c) => { try { const x = c.v(f); return x === undefined ? null : x; } catch (e) { return null; } }));
    return [cab, ...cuerpo];
  }
  const hayDatos = (m) => !!(m && m.length > 1);

  // ---- CSV
  function celdaCsv(v) {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
    let s = String(v).replace(/\r?\n|\r/g, ' ');
    if (/^[=+\-@\t]/.test(s) && !/^-?[0-9]+([.,][0-9]+)?$/.test(s)) s = "'" + s;   // = + - @ al inicio: formula, salvo que sea un numero simple
    return /[";]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(m) { return '﻿' + (m || []).map((f) => f.map(celdaCsv).join(SEP)).join('\r\n') + '\r\n'; }

  // ---- Excel (XLSX de SheetJS, inyectado). Los numeros quedan como numeros; el texto como texto (no se interpreta como formula).
  const nombreHoja = (s) => String(s || 'Datos').replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Datos';
  function anchos(m) {
    const n = (m && m[0] ? m[0].length : 0), w = new Array(n).fill(8);
    for (const f of (m || []).slice(0, 500)) f.forEach((v, i) => { const l = v == null ? 0 : String(v).length; if (l > w[i]) w[i] = l; });
    return w.map((x) => ({ wch: Math.min(60, x + 2) }));
  }
  function libro(m, hoja, XLSX) {
    if (!XLSX || !XLSX.utils) throw new Error('La librería de Excel no está disponible. Descarga el CSV.');
    const datos = (m || []).map((f) => f.map((v) => (v instanceof Date ? (isNaN(v) ? null : v.toISOString().slice(0, 10)) : v)));
    const ws = XLSX.utils.aoa_to_sheet(datos);
    ws['!cols'] = anchos(m);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nombreHoja(hoja));
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  // ---- nombre del archivo: sin tildes ni signos, con la fecha
  const slug = (s) => String(s || 'datos').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'datos';
  const nombreArchivo = (base, ext, hoy) => `${slug(base)}_${hoy}.${ext}`;

  // numero seguro para una celda (texto "1.234,5" o vacio -> null)
  const num = (x) => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

  return { SEP, matriz, hayDatos, celdaCsv, csv, nombreHoja, anchos, libro, slug, nombreArchivo, num };
});
