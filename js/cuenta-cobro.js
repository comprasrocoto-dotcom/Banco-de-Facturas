// ============================================================
//  cuenta-cobro.js  -  CUENTAS DE COBRO CON FOTO (13/10/2026, pedido del usuario)
// ============================================================
// La sede toma la foto de la cuenta de cobro, escribe el N°, la Fecha Recibido, el total y la cantidad y el precio de
// cada articulo del pedido segun el papel. Esto valida (puro, sin pantalla) antes de subir; la base vuelve a validar
// todo en cuenta_cobro_amarrar. El agente ingresa al ERP exactamente lo digitado (no lee la foto).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuentaCobro = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // numero escrito a la colombiana: "12.500" = 12500; "1.234,5" = 1234.5; "2,5" = 2.5; "2.5" = 2.5
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v == null ? '' : v).replace(/[$\s]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  // cantidad: decimal normal ("1.5" o "1,5" = uno y medio; nunca miles: una cantidad "1.500" seria 1.5 kilos mal leidos)
  function cantidad(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  }
  const numeroLimpio = (t) => String(t == null ? '' : t).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // precio unitario = total del articulo / cantidad, con 2 decimales (el ERP recibe el precio unitario)
  const unitario = (total, cant) => Math.round((total / cant) * 100) / 100;

  // (13/10/2026, pedido del usuario) en cada articulo se escribe la CANTIDAD y el TOTAL DE ESE ARTICULO (como viene en el papel):
  // el precio unitario sale solo (total / cantidad) y el total de la cuenta es la suma de los articulos (ya no se digita).
  // datos = { numero, foto: boolean, lineas: [{codigo, articulo, cantidad, total}] } (la fecha se valida aparte con FechaRecibido)
  // -> { ok, errores[], lineas (solo las que llegaron: cantidad > 0, con su precio_unitario), total }
  function validar(datos) {
    const d = datos || {}, errores = [];
    if (!d.foto) errores.push('Toma o elige la foto de la cuenta de cobro.');
    if (!numeroLimpio(d.numero)) errores.push('Escribe el número de la cuenta de cobro (el que trae el papel).');
    const lineas = [], sinTotal = [], malas = [];
    for (const l of d.lineas || []) {
      const nombre = String(l.articulo || '').trim();
      const vacia = String(l.cantidad == null ? '' : l.cantidad).trim() === '';
      const cant = cantidad(l.cantidad);
      if (vacia || cant === 0) continue;   // no llego: no va en la cuenta
      if (cant == null || cant < 0) { malas.push(nombre); continue; }
      if (String(l.total == null ? '' : l.total).trim() === '') { sinTotal.push(nombre); continue; }
      const tot = num(l.total);
      if (tot == null || tot < 0) { malas.push(nombre); continue; }
      lineas.push({ codigo: l.codigo || null, articulo: nombre, cantidad: cant, precio_unitario: unitario(tot, cant), subtotal: Math.round(tot) });
    }
    if (sinTotal.length) errores.push('Falta el total de: ' + sinTotal.join(', ') + ' (si no llegó, pon la cantidad en 0).');
    if (malas.length) errores.push('Revisa la cantidad o el total de: ' + malas.join(', ') + '.');
    if (!lineas.length && !sinTotal.length && !malas.length) errores.push('Escribe la cantidad y el total de lo que llegó (al menos un artículo).');
    const total = lineas.reduce((s, l) => s + l.subtotal, 0);
    if (lineas.length && total <= 0) errores.push('El total de la cuenta no puede ser $ 0.');
    return { ok: !errores.length, errores, lineas, total };
  }

  // donde se guarda la foto en el almacenamiento (la base exige que empiece por cuentas_cobro/)
  function rutaFoto(pedido, ahoraMs) {
    const p = pedido || {};
    return 'cuentas_cobro/' + (p.marca_id || 'sin-marca') + '/' + String(p.numero || p.id || 'pedido').replace(/[^A-Za-z0-9-]/g, '') + '_' + (ahoraMs || Date.now()) + '.jpg';
  }

  return { num, cantidad, unitario, numeroLimpio, validar, rutaFoto };
});
