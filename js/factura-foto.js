// ============================================================
//  factura-foto.js  -  FOTO DE LA FACTURA EN EL PEDIDO -> se busca sola en el banco y se amarra (14/10/2026)
// ============================================================
// Pedido del usuario: las facturas se siguen subiendo al banco como siempre; la sede, desde el pedido, toma una foto de la
// factura donde se vea el numero, y el sistema busca ESA factura en el banco y la amarra a ESE pedido (como las cuentas de
// cobro, pero la factura ya existe). Si todavia no esta en el banco, queda esperando y se amarra sola cuando llegue
// (supabase/factura_foto.sql: tabla factura_foto + factura_foto_registrar + trigger en facturas).
// El numero sale del CODIGO QR de la factura electronica (lectura exacta del codigo, sin IA) o lo escribe la sede.
// Este modulo es puro (sin red ni DOM): lo usan la ventana (factura-foto-ui.js) y las pruebas. La comparacion de numeros
// es la MISMA que hace la base (factura_numero_coincide): si cambia una, cambiar la otra.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FacturaFoto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const alnum = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sinCerosIzq = (s) => String(s || '').replace(/^0+(?=\d)/, '');
  const sinCerosDer = (s) => String(s || '').replace(/0+$/, '');

  // Texto del QR de la factura electronica DIAN -> { cufe, numero, nit, total, fecha } (lo que traiga; null si no es de la DIAN)
  // Formatos vistos: "NumFac: FE38865 FecFac: 2026-10-14 ... NitFac: 900123456 ... CUFE: <96 hex> ... QRCode: https://catalogo-vpfe..."
  // o solo la direccion "https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=<cufe>".
  function leerQR(texto) {
    const t = String(texto == null ? '' : texto);
    if (!t.trim()) return null;
    const campo = (nombre) => { const m = t.match(new RegExp(nombre + '\\s*[:=]\\s*([^\\s\\n\\r]+)', 'i')); return m ? m[1].trim() : null; };
    let cufe = null;
    const mk = t.match(/documentkey=([0-9a-f]{96})/i) || t.match(/CU[FD]E\s*[:=]\s*([0-9a-f]{96})/i) || t.match(/\b([0-9a-f]{96})\b/i);
    if (mk) cufe = mk[1].toLowerCase();
    const numero = campo('NumFac') || campo('NumDS') || campo('NumNC') || null;
    const nit = campo('NitFac') || campo('NitOFE') || null;
    const totalTxt = campo('ValTolFac') || campo('ValTotFac') || campo('ValPag') || null;
    const total = totalTxt != null && isFinite(Number(totalTxt.replace(/,/g, ''))) ? Number(totalTxt.replace(/,/g, '')) : null;
    const fecha = campo('FecFac') || null;
    if (!cufe && !numero) return null;
    return { cufe, numero: numero ? alnum(numero) : null, nit: nit ? nit.replace(/\D/g, '') : null, total, fecha };
  }

  // lo que escribe la sede -> como se guarda ("fe-038865 " -> "FE038865")
  const numeroLimpio = (s) => alnum(s);

  // ¿el numero escrito (o leido) es el de esta factura del banco? { prefijo, folio, documento }
  //  - igual a documento o a prefijo+folio (sin espacios, guiones ni mayusculas);
  //  - o termina en el folio y lo que queda delante es el prefijo (o nada), sin contar ceros: "38865", "FE038865", "FE-38865".
  //  Solo numeros que NO son el folio completo no cuentan ("6880" no es "16880").
  function coincide(escrito, f) {
    const e = alnum(escrito);
    if (!e || !f) return false;
    const pre = alnum(f.prefijo), fol = alnum(f.folio), doc = alnum(f.documento || (pre + fol));
    if (e === doc || (fol && e === pre + fol)) return true;
    const folN = sinCerosIzq(fol.replace(/\D/g, '') === fol ? fol : '');
    if (!folN) return false;
    const m = e.match(/^(.*?)(\d+)$/);
    if (!m) return false;
    // probar cada corte posible de la parte numerica final (el prefijo puede tener numeros: "IM50", "27FE")
    for (let i = 0; i < m[2].length; i++) {
      const delante = m[1] + m[2].slice(0, i), atras = m[2].slice(i);
      if (sinCerosIzq(atras) !== folN) continue;
      const d = sinCerosDer(delante);
      if (d === '' || d === sinCerosDer(pre)) return true;
    }
    return false;
  }

  // ruta de la foto en el storage "facturas"
  function rutaFoto(pedido, ms, ext) {
    const sede = alnum((pedido && pedido.sede_texto) || 'SEDE').slice(0, 30) || 'SEDE';
    return 'fotos_factura/' + sede + '/' + ((pedido && (pedido.numero || pedido.id)) || 'PED') + '_' + (ms || Date.now()) + '.' + (ext || 'jpg');
  }

  // estado de la foto -> texto corto para el pedido
  function aviso(foto) {
    if (!foto) return '';
    const n = foto.numero || '';
    if (foto.estado === 'ESPERANDO') return '📸 Factura ' + n + ': esperando que llegue al banco (se amarra sola)';
    if (foto.estado === 'NOVEDAD') return '⚠️ Factura ' + n + ': ' + (foto.motivo || 'revisar');
    if (foto.estado === 'AMARRADA') return '✅ Factura ' + n + ' amarrada por foto';
    return '';
  }

  // (14/10/2026) que botones ofrece el pedido segun el documento que entrega el proveedor (proveedores.documento):
  //  'factura' -> foto de la factura + amarrar; 'cuenta_cobro' -> solo cuenta de cobro; sin definir -> los tres (como antes)
  function botonesPedido(documento) {
    if (documento === 'factura') return { foto: true, amarrar: true, cuenta: false };
    if (documento === 'cuenta_cobro') return { foto: false, amarrar: false, cuenta: true };
    return { foto: true, amarrar: true, cuenta: true };
  }
  const DOCUMENTOS = [['', 'Sin definir (el pedido muestra todo)'], ['factura', 'Factura electrónica'], ['cuenta_cobro', 'Cuenta de cobro']];

  return { leerQR, numeroLimpio, coincide, rutaFoto, aviso, alnum, botonesPedido, DOCUMENTOS };
});
