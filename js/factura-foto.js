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
    const n = foto.numero && foto.numero !== 'SN' ? foto.numero : '';
    const doc = foto.tipo_doc === 'nota_credito' ? 'Nota crédito' : foto.tipo_doc === 'devolucion' ? 'Devolución' : foto.tipo_doc === 'otro' ? 'Documento' : 'Factura';
    if (foto.estado === 'ESPERANDO') return '📸 ' + doc + ' ' + n + ': ' + (foto.motivo || 'esperando que llegue al banco (se amarra sola)');
    if (foto.estado === 'NOVEDAD') return '⚠️ ' + doc + ' ' + n + ': ' + (foto.motivo || 'revisar');
    if (foto.estado === 'AMARRADA') return '✅ ' + doc + ' ' + n + ' amarrada por foto';
    if (foto.estado === 'GUARDADA') return '📎 ' + doc + ' ' + n + ' guardada como soporte';
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

  // (15/10/2026) TIPO DE DOCUMENTO de la foto y NOVEDAD al recibir (supabase/factura_foto_documentos.sql)
  const TIPOS_DOC = [['factura', 'Factura electrónica'], ['nota_credito', 'Nota crédito'], ['devolucion', 'Devolución'], ['otro', 'Otro documento']];
  const NOVEDADES = [['', 'Sin novedad: llegó todo bien'], ['devolucion', 'Devolución'], ['faltante', 'Faltante (no llegó completo)'], ['danado', 'Producto dañado'], ['precio', 'Precio distinto'], ['otra', 'Otra']];
  const nombreTipo = (t) => (TIPOS_DOC.find((x) => x[0] === t) || TIPOS_DOC[0])[1];
  // que pide cada tipo: la factura se amarra al pedido (numero, fecha >= pedido y centro de costo); la nota credito se busca
  // por numero; devolucion / otro son soporte (numero opcional)
  function requisitos(tipo) {
    if (tipo === 'nota_credito') return { numero: true, centro: false, fechaPedido: false, qr: true };
    if (tipo === 'devolucion' || tipo === 'otro') return { numero: false, centro: false, fechaPedido: false, qr: false };
    return { numero: true, centro: true, fechaPedido: true, qr: true };
  }
  // tipos que se ofrecen en el pedido: sin factura amarrada -> todos; con factura -> sin "factura"; proveedor de cuenta de cobro -> soportes
  function tiposOfrecidos(pedido, soloSoportes) {
    return TIPOS_DOC.filter(([t]) => {
      if (soloSoportes) return t === 'devolucion' || t === 'otro';
      if (pedido && pedido.factura_cufe && t === 'factura') return false;
      return true;
    });
  }
  // novedad escrita -> { ok, error?, tipo, texto }
  function validarNovedad(tipo, texto) {
    const t = NOVEDADES.some((x) => x[0] === tipo && tipo) ? tipo : null;
    const tx = String(texto == null ? '' : texto).trim();
    if (!t) return { ok: true, tipo: null, texto: null };
    if (!tx) return { ok: false, error: 'Escribe qué pasó (la novedad).' };
    if (tx.length > 1000) return { ok: false, error: 'La novedad es muy larga (máximo 1000 letras).' };
    return { ok: true, tipo: t, texto: tx };
  }

  // error de la base que dice "esa funcion no existe con esos datos" (aun no se aplico factura_foto_documentos.sql)
  function baseSinDocumentos(err) {
    const t = String((err && (err.message || '')) + ' ' + (err && (err.code || '')) + ' ' + (err && (err.details || '')) + ' ' + (err && (err.hint || '')));
    return /PGRST202|could not find the function|function .*factura_foto_registrar.* does not exist|p_tipo/i.test(t);
  }

  return { leerQR, numeroLimpio, coincide, rutaFoto, aviso, alnum, botonesPedido, DOCUMENTOS, TIPOS_DOC, NOVEDADES, nombreTipo, requisitos, tiposOfrecidos, validarNovedad, baseSinDocumentos };
});
