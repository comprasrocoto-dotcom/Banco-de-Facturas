// ============================================================
//  precios.js  -  MODULO "VARIACION DE PRECIOS": logica pura  (21/09/2026)
//   Filtros, orden, formatos, niveles y lectura de listas de precios de un proveedor (CSV).
//   Lo que ya cambio de precio lo decide la base (funcion precio_registrar): aqui solo se muestra y se prepara lo que se le envia.
//  Logica PURA y determinista (sin red, sin IA). La usa index.html (js/precios-ui.js) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./importacion.js'));
  else root.Precios = factory(root.Importacion);
})(typeof self !== 'undefined' ? self : this, function (Imp) {
  'use strict';

  // Sensibilidad (como en la lista de "ingresos anomalos"): el % minimo que se muestra
  const SENSIBILIDAD = { alta: 2, media: 5, baja: 10 };
  // Gravedad de un cambio, para el color: mas de 20 % fuerte, de 10 a 20 medio, el resto suave
  const nivelDe = (pct) => { const a = Math.abs(Number(pct) || 0); return a >= 20 ? 'alta' : a >= 10 ? 'media' : 'baja'; };

  const conPuntos = (n) => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // "$ 48.500" o "$ 1.527,50"
  function fmtPeso(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    const v = Number(n), cent = Math.round(Math.abs(v) * 100), ent = Math.floor(cent / 100), dec = cent % 100;
    return '$ ' + (v < 0 && cent > 0 ? '-' : '') + conPuntos(ent) + (dec ? ',' + String(dec).padStart(2, '0') : '');
  }
  // "+7,8 %" / "-5,2 %"
  function fmtPct(p) {
    if (p == null || isNaN(Number(p))) return '—';
    const v = Number(p), s = (Math.round(Math.abs(v) * 10) / 10).toFixed(1).replace('.', ',');
    return (v > 0 ? '+' : v < 0 ? '-' : '') + s + ' %';
  }

  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u{300}-\u{36f}]/gu, '').toLowerCase().trim();
  const fechaDe = (v) => String(v.fecha_nueva || '').slice(0, 10);

  // f: { estado: 'nueva'|'revisada'|'descartada'|'todas', q, minPct, sentido: 'sube'|'baja'|null, desde, hasta }
  function filtrar(lista, f) {
    f = f || {}; const q = norm(f.q), digitos = q.replace(/\D/g, '');
    return (lista || []).filter((v) => {
      if (f.estado && f.estado !== 'todas' && v.estado !== f.estado) return false;
      if (f.minPct != null && Math.abs(Number(v.variacion_pct)) < Number(f.minPct)) return false;
      if (f.sentido === 'sube' && !(Number(v.variacion_pct) > 0)) return false;
      if (f.sentido === 'baja' && !(Number(v.variacion_pct) < 0)) return false;
      if (f.desde && fechaDe(v) < f.desde) return false;
      if (f.hasta && fechaDe(v) > f.hasta) return false;
      if (q && !(norm(v.articulo_texto).includes(q) || norm(v.proveedor_nombre).includes(q) || (digitos.length >= 3 && String(v.proveedor_nit || '').includes(digitos)) || norm(v.factura_ref).includes(q))) return false;
      return true;
    });
  }
  // Lo mas reciente primero; a igual fecha, el cambio mas grande; luego el mas nuevo
  const ordenar = (lista) => (lista || []).slice().sort((a, b) => fechaDe(b).localeCompare(fechaDe(a)) || Math.abs(Number(b.variacion_pct)) - Math.abs(Number(a.variacion_pct)) || (Number(b.id) || 0) - (Number(a.id) || 0));

  function resumen(lista) {
    const l = lista || [], r = { total: l.length, nuevas: 0, suben: 0, bajan: 0, proveedores: new Set(), mayor: null };
    for (const v of l) {
      if (v.estado === 'nueva') r.nuevas++;
      const p = Number(v.variacion_pct); if (p > 0) r.suben++; else if (p < 0) r.bajan++;
      r.proveedores.add(v.proveedor_nit);
      if (!r.mayor || Math.abs(p) > Math.abs(Number(r.mayor.variacion_pct))) r.mayor = v;
    }
    r.proveedores = r.proveedores.size; return r;
  }

  // ---------------------------------------------------------------- LISTA DE PRECIOS DEL PROVEEDOR (CSV)
  const COLS = [
    { campo: 'nit', nombre: 'nit', req: true, alias: ['nit_proveedor', 'proveedor_nit', 'identificacion'] },
    { campo: 'articulo', nombre: 'articulo', req: true, alias: ['producto', 'descripcion', 'insumo', 'item', 'nombre'] },
    { campo: 'precio', nombre: 'precio', req: true, alias: ['precio_unitario', 'valor', 'costo', 'precio_nuevo', 'valor_unitario'] },
    { campo: 'proveedor', nombre: 'proveedor', req: false, alias: ['razon_social', 'nombre_proveedor'] },
    { campo: 'fecha', nombre: 'fecha', req: false, alias: ['vigente_desde', 'fecha_vigencia', 'desde'] },
    { campo: 'codigo', nombre: 'codigo', req: false, alias: ['cod', 'codigo_barras'] },
    { campo: 'unidad', nombre: 'unidad', req: false, alias: ['presentacion'] },
  ];
  // "2026-09-15", "15/09/2026", "15-9-26" -> "2026-09-15" ; null si no se entiende
  function fechaISO(t) {
    const s = String(t == null ? '' : t).trim(); if (!s) return undefined;
    let y, m, d, x;
    if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { y = +x[1]; m = +x[2]; d = +x[3]; }
    else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) { d = +x[1]; m = +x[2]; y = +x[3]; if (y < 100) y += 2000; }
    else return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  }
  const limpio = (s) => String(s == null ? '' : s).replace(/^\ufeff/, '').replace(/\s+/g, ' ').trim();

  // -> { ok, errores (del archivo), delimitador, ignoradas, filas: [{ n, datos, errores, avisos }] }
  function leerLista(texto, hoy) {
    const { delimitador, registros } = Imp.parseCSV(texto);
    const salida = { ok: false, errores: [], delimitador, ignoradas: [], filas: [] };
    if (!registros.length) { salida.errores.push('el archivo está vacío'); return salida; }
    const cab = registros[0].celdas.map(limpio), usadas = new Set(), mapa = {};
    for (const c of COLS) {
      const nombres = [c.nombre].concat(c.alias);
      const i = cab.findIndex((h, k) => !usadas.has(k) && h && nombres.includes(Imp.claveCol(h)));
      if (i >= 0) { usadas.add(i); mapa[c.campo] = i; }
    }
    salida.ignoradas = cab.filter((h, k) => h && !usadas.has(k));
    const faltan = COLS.filter((c) => c.req && mapa[c.campo] == null);
    if (faltan.length) salida.errores.push('faltan columnas obligatorias: ' + faltan.map((c) => c.nombre).join(', ') + ' (las encontradas: ' + (cab.filter(Boolean).join(', ') || 'ninguna') + ')');
    const cuerpo = registros.slice(1);
    if (!cuerpo.length && !faltan.length) salida.errores.push('el archivo solo tiene el encabezado, no hay filas');
    if (cuerpo.length > 2000) salida.errores.push(`el archivo tiene ${cuerpo.length} filas y el máximo es 2000: divídelo en partes`);
    if (salida.errores.length) return salida;
    const vistos = new Map();
    for (const reg of cuerpo) {
      const err = [], avisos = [], celda = (campo) => (mapa[campo] == null ? '' : reg.celdas[mapa[campo]]);
      const nit = Imp.normalizar({ tipo: 'nit' }, celda('nit')); if (nit.error) err.push('nit: ' + nit.error); if (nit.aviso) avisos.push(nit.aviso);
      const art = limpio(celda('articulo')); if (!art) err.push('falta el artículo');
      let precio = null; const pn = Imp.numero(celda('precio'));
      if (pn.vacio) err.push('falta el precio'); else if (pn.error) err.push(`precio: "${limpio(celda('precio'))}" no es un número`); else if (!(pn.valor > 0)) err.push('el precio debe ser mayor que 0'); else { precio = pn.valor; if (pn.aviso) avisos.push(pn.aviso); }
      const f = fechaISO(celda('fecha')); if (f === null) err.push(`fecha: "${limpio(celda('fecha'))}" no se entiende (usa AAAA-MM-DD o DD/MM/AAAA)`); else if (f && hoy && f > hoy) err.push('la fecha es futura');
      if (nit.valor && (nit.valor.length < 5 || nit.valor.length > 15)) err.push('el NIT no parece válido (debe tener entre 5 y 15 dígitos)');
      const datos = { nit: nit.valor || undefined, articulo: art || undefined, precio: precio == null ? undefined : precio, proveedor: limpio(celda('proveedor')) || undefined,
        fecha: f || undefined, codigo: limpio(celda('codigo')) || undefined, unidad: limpio(celda('unidad')) || undefined };
      if (!err.length) { const k = [datos.nit, String(datos.articulo).toUpperCase().replace(/[^A-Z0-9]/g, ''), datos.fecha || ''].join('|'); if (vistos.has(k)) err.push(`repetida en el archivo (misma que la fila ${vistos.get(k)})`); else vistos.set(k, reg.n); }
      salida.filas.push({ n: reg.n, datos, errores: err, avisos });
    }
    salida.ok = true; return salida;
  }
  // Las filas sin error, tal como las recibe precio_registrar
  const aServidor = (leido) => leido.filas.filter((f) => !f.errores.length).map((f) => { const o = { n: f.n }; for (const k of Object.keys(f.datos)) if (f.datos[k] !== undefined) o[k] = f.datos[k]; return o; });

  const plantilla = () => String.fromCharCode(0xFEFF) + ['nit;proveedor;articulo;precio;fecha;codigo;unidad', '900123456;DISTRIBUIDORA EJEMPLO S.A.S.;ARROZ DIANA X 500G;2100;2026-09-20;;'].join('\r\n') + '\r\n';

  return { SENSIBILIDAD, nivelDe, fmtPeso, fmtPct, filtrar, ordenar, resumen, fechaISO, leerLista, aServidor, plantilla, COLS };
});
