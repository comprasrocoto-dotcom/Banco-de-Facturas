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

  // datos = { numero, fecha (validada aparte con FechaRecibido), total, foto: boolean, lineas: [{codigo, articulo, cantidad, precio}] }
  // -> { ok, errores[], lineas (solo las que llegaron: cantidad > 0), suma, diferencia }
  function validar(datos) {
    const d = datos || {}, errores = [];
    if (!d.foto) errores.push('Toma o elige la foto de la cuenta de cobro.');
    if (!numeroLimpio(d.numero)) errores.push('Escribe el número de la cuenta de cobro (el que trae el papel).');
    const total = num(d.total);
    if (total == null || total <= 0) errores.push('Escribe el total de la cuenta de cobro.');
    const lineas = [], sinPrecio = [], malas = [];
    for (const l of d.lineas || []) {
      const nombre = String(l.articulo || '').trim();
      const vacia = String(l.cantidad == null ? '' : l.cantidad).trim() === '';
      const cant = cantidad(l.cantidad);
      if (vacia || cant === 0) continue;   // no llego: no va en la cuenta
      if (cant == null || cant < 0) { malas.push(nombre); continue; }
      const precio = num(l.precio);
      if (String(l.precio == null ? '' : l.precio).trim() === '') { sinPrecio.push(nombre); continue; }
      if (precio == null || precio < 0) { malas.push(nombre); continue; }
      lineas.push({ codigo: l.codigo || null, articulo: nombre, cantidad: cant, precio_unitario: precio, subtotal: Math.round(cant * precio) });
    }
    if (sinPrecio.length) errores.push('Falta el precio de: ' + sinPrecio.join(', ') + ' (si no llegó, pon la cantidad en 0).');
    if (malas.length) errores.push('Revisa la cantidad o el precio de: ' + malas.join(', ') + '.');
    if (!lineas.length && !sinPrecio.length && !malas.length) errores.push('Escribe la cantidad y el precio de lo que llegó (al menos un artículo).');
    const suma = lineas.reduce((s, l) => s + l.subtotal, 0);
    const diferencia = total == null ? null : suma - total;
    if (total != null && total > 0 && lineas.length && Math.abs(diferencia) > Math.max(1, lineas.length)) {
      errores.push('Los artículos suman $ ' + suma.toLocaleString('es-CO') + ' y el total de la cuenta es $ ' + total.toLocaleString('es-CO') + ': revisa cantidades y precios.');
    }
    return { ok: !errores.length, errores, lineas, suma, total, diferencia };
  }

  // donde se guarda la foto en el almacenamiento (la base exige que empiece por cuentas_cobro/)
  function rutaFoto(pedido, ahoraMs) {
    const p = pedido || {};
    return 'cuentas_cobro/' + (p.marca_id || 'sin-marca') + '/' + String(p.numero || p.id || 'pedido').replace(/[^A-Za-z0-9-]/g, '') + '_' + (ahoraMs || Date.now()) + '.jpg';
  }

  return { num, cantidad, numeroLimpio, validar, rutaFoto };
});
