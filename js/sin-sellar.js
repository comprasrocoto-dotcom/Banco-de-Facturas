// ============================================================
//  sin-sellar.js  -  (19/09/2026)
//   1) "Ingresadas sin sellar": facturas que YA tienen N° de ingreso del ERP pero siguen en Sin asignar o en Mías sin sellar
//      (a la sede se le olvido decir "Es mía", firmar o sellar). Cuantas son, de que sede, y hace cuantos dias.
//   2) Ayuda para AMARRAR el pedido correcto: los pedidos del mismo proveedor primero, y un vistazo a sus insumos.
//  Logica PURA y determinista (sin red, sin IA). La usa index.html y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./conciliacion.js'));
  else root.SinSellar = factory(root.Conciliacion);
})(typeof self !== 'undefined' ? self : this, function (Conc) {
  'use strict';

  const DIAS_AVISO = 2, DIAS_ALERTA = 5;      // amarillo desde 2 dias, rojo desde 5

  // "2026-09-16" -> dias enteros entre dos fechas ISO (sin horas: no depende de la zona horaria)
  function diasEntre(desde, hasta) {
    const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(desde || '')), b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(hasta || ''));
    if (!a || !b) return null;
    const t = (m) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Math.round((t(b) - t(a)) / 86400000);
  }
  const conIngreso = (f) => !!(f && f.num_ingreso && String(f.num_ingreso).trim());
  // Ya ingresada al ERP y todavia sin sellar (sin asignar o en manos de la sede sin sellar)
  const esIngresadaSinSellar = (f) => !!f && (f.estado === 'pool' || f.estado === 'asignada') && conIngreso(f);

  // Que se le dice a la persona: "Ingresada al ERP hace 3 dias · falta sellar"
  function etiqueta(f, hoy) {
    const d = diasEntre(f.fecha_ingreso && f.fecha_ingreso !== 'null' ? f.fecha_ingreso : null, hoy);
    const quien = f.estado === 'pool' ? 'nadie la ha tomado (falta “Es mía”)' : 'falta sellar';
    if (d == null) return { dias: null, nivel: 'aviso', texto: 'Ingresada al ERP (sin fecha) · ' + quien };
    const cuando = d <= 0 ? 'hoy' : d === 1 ? 'ayer' : 'hace ' + d + ' días';
    return { dias: Math.max(d, 0), nivel: d >= DIAS_ALERTA ? 'alerta' : d >= DIAS_AVISO ? 'aviso' : 'nuevo', texto: 'Ingresada al ERP ' + cuando + ' · ' + quien };
  }
  // Mas antiguas primero (las que llevan mas tiempo olvidadas); las que no tienen fecha, al final
  function ordenar(lista) {
    const f = (x) => (x.fecha_ingreso && x.fecha_ingreso !== 'null' ? String(x.fecha_ingreso) : '9999-99-99');
    return lista.slice().sort((a, b) => f(a).localeCompare(f(b)) || String(a.fecha_emision || '').localeCompare(String(b.fecha_emision || '')));
  }
  // La sede de una factura: la suya; si aun no la tiene (Sin asignar), la del pedido al que esta amarrada. Nunca se adivina.
  function sedeDe(f, sedePorFactura) {
    if (f.sede_id != null) return { id: f.sede_id, origen: 'factura' };
    const s = sedePorFactura && sedePorFactura.get ? sedePorFactura.get(f.cufe) : null;
    return s != null ? { id: s, origen: 'pedido' } : { id: null, origen: null };
  }
  // [{ id, nombre, n, masVieja }] de la sede que mas debe a la que menos
  function resumenPorSede(lista, sedePorFactura, sedes, hoy) {
    const m = new Map();
    for (const f of lista) {
      const s = sedeDe(f, sedePorFactura).id, k = s == null ? 'none' : String(s);
      const e = m.get(k) || { id: s, nombre: s == null ? 'Sin sede' : ((sedes || []).find((x) => x.id === s) || {}).nombre || ('Sede ' + s), n: 0, masVieja: null };
      e.n++; const d = etiqueta(f, hoy).dias; if (d != null && (e.masVieja == null || d > e.masVieja)) e.masVieja = d;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre));
  }
  const mensajeAviso = (n) => n === 1 ? 'Tienes 1 factura ya ingresada al ERP sin sellar.' : 'Tienes ' + n + ' facturas ya ingresadas al ERP sin sellar.';

  // ---------------------------------------------------------------- AMARRAR: pedido correcto
  const soloDig = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  // ¿el pedido es del mismo proveedor que la factura?  'igual' | 'parecido' | null   (por NIT si el pedido lo trae; si no, por nombre)
  function mismoProveedor(factura, pedido) {
    const nf = soloDig(factura && factura.nit_emisor), np = soloDig(pedido && pedido.nit_proveedor);
    if (nf && np) return nf === np ? 'igual' : null;
    return Conc.compararProveedor(nf, factura && factura.emisor, pedido && (pedido.proveedor_texto || pedido.proveedor));
  }
  // Los pedidos del mismo proveedor primero, luego los parecidos, luego el resto; dentro de cada grupo se respeta el orden que ya traian.
  function ordenarPedidos(factura, pedidos) {
    const rank = { igual: 0, parecido: 1 };
    return pedidos.map((p, i) => ({ p, i, r: rank[mismoProveedor(factura, p)] != null ? rank[mismoProveedor(factura, p)] : 2 }))
      .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.p);
  }
  // Vistazo a los insumos: una linea corta para la tarjeta y la lista completa para el globo (tooltip)
  function vistazoInsumos(lineas, max) {
    max = max || 4;
    const ls = (lineas || []).filter((l) => l && (l.insumo || l.codigo));
    if (!ls.length) return { n: 0, corto: 'Sin artículos cargados', completo: '' };
    const nombre = (l) => String(l.insumo || l.codigo).trim();
    const cant = (l) => (l.cantidad != null && l.cantidad !== '' ? ' — ' + l.cantidad + (l.unidad ? ' ' + l.unidad : '') : '');
    const corto = ls.slice(0, max).map(nombre).join(', ') + (ls.length > max ? ' (+' + (ls.length - max) + ' más)' : '');
    return { n: ls.length, corto, completo: ls.map((l) => '• ' + nombre(l) + cant(l)).join('\n') };
  }

  return { DIAS_AVISO, DIAS_ALERTA, diasEntre, conIngreso, esIngresadaSinSellar, etiqueta, ordenar, sedeDe, resumenPorSede, mensajeAviso, mismoProveedor, ordenarPedidos, vistazoInsumos };
});
