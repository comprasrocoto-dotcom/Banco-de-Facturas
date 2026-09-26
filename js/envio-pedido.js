// ============================================================
//  envio-pedido.js  -  ENVIAR EL PEDIDO AL PROVEEDOR (correo + WhatsApp)  (22/09/2026)   (modulo Pedidos)
//  Todo sale de lo que YA existe: proveedores (correo, telefono1 = WhatsApp, asesor), pedidos (numero, fecha, observacion_pedido), pedido_lineas /
//  articulos (unidad de COMPRA tal cual, sin reconvertir). Aqui vive la logica pura y determinista (SIN IA, SIN red):
//    - validar el contacto (correo valido / celular valido) por canal, sin bloquear un canal porque falte el otro;
//    - armar el asunto, el cuerpo del correo y el texto de WhatsApp con los datos reales del pedido;
//    - decidir el estado de cada canal y del pedido a partir de los intentos registrados (pedido_envio) y de la cola de correo (correo_cola).
//  La usa index.html (js/envio-pedido-ui.js) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EnvioPedido = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const t = (x) => String(x == null ? '' : x).trim();

  // ---------------------------------------------------------------- CONTACTO
  const RX_CORREO = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  // proveedores.correo puede traer varios (separados por coma, punto y coma o espacio): se usan los validos
  function validarCorreo(texto) {
    const crudos = t(texto).split(/[;,\s]+/).map(t).filter(Boolean);
    if (!crudos.length) return { ok: false, valor: '', motivo: 'No es posible enviar por correo porque el proveedor no tiene correo registrado.' };
    const validos = [...new Set(crudos.filter((c) => RX_CORREO.test(c)).map((c) => c.toLowerCase()))];
    if (!validos.length) return { ok: false, valor: '', motivo: 'No es posible enviar por correo porque el correo registrado del proveedor no es válido (' + crudos[0] + ').' };
    return { ok: true, valor: validos.join(', '), motivo: '' };
  }

  // telefono1 del proveedor = su WhatsApp. Celular colombiano: 10 digitos que empiezan por 3 (con o sin 57). Puede traer varios numeros: sirve el primer celular.
  // -> { ok, valor: '573001234567' (para wa.me), visible: '300 123 4567', motivo }
  function validarWhatsapp(texto) {
    const crudo = t(texto);
    if (!crudo) return { ok: false, valor: '', visible: '', motivo: 'No es posible enviar por WhatsApp porque el proveedor no tiene número registrado.' };
    const candidatos = crudo.split(/[\/;,]|\s-\s|\sy\s/i).map(t).filter(Boolean);
    for (const c of candidatos) {
      let d = c.replace(/\D/g, '');
      if (d.startsWith('0057')) d = d.slice(4); else if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
      if (/^3\d{9}$/.test(d)) return { ok: true, valor: '57' + d, visible: `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`, motivo: '' };
    }
    return { ok: false, valor: '', visible: '', motivo: 'No es posible enviar por WhatsApp porque el número registrado del proveedor (' + crudo + ') no parece un celular.' };
  }

  // -> { correo, whatsapp, hayAlguno }
  function contacto(prov) {
    prov = prov || {};
    const correo = validarCorreo(prov.correo), whatsapp = validarWhatsapp(prov.telefono1);
    return { correo, whatsapp, hayAlguno: correo.ok || whatsapp.ok };
  }

  // ---------------------------------------------------------------- MENSAJES
  function fechaCorta(iso) {                                           // '2026-09-22' -> '22/09/2026' (sin pasar por Date: no hay corrimiento de zona horaria)
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t(iso)); return m ? `${m[3]}/${m[2]}/${m[1]}` : t(iso);
  }
  function cantidadTexto(n) {                                          // 10 -> "10" ; 2.5 -> "2,5"
    const x = Number(n); if (!isFinite(x)) return t(n);
    return String(Math.round(x * 1000) / 1000).replace('.', ',');
  }
  // La unidad es la de COMPRA que ya maneja el sistema (articulos.unimedida_compra; si no, la guardada en la linea). NO se convierte ni se inventa.
  function unidadDe(linea, unidades) { return t((unidades && linea && unidades[linea.codigo]) || (linea && linea.unidad)); }

  // datos: { pedido, proveedor, lineas:[{codigo,insumo,cantidad,unidad}], unidades:{codigo:unidad}, empresa, intento, detalleWhatsapp }
  //   detalleWhatsapp === false: el texto de WhatsApp NO lista los productos (van en el PDF de la orden, que se manda aparte como archivo). Si no hay PDF se lista el detalle (para que el proveedor no reciba un pedido vacio).
  //   intento > 1 = reenvio: el asunto lo dice (y asi la cola no lo toma por un duplicado del envio anterior)
  function armarMensajes(datos) {
    const p = (datos && datos.pedido) || {}, prov = (datos && datos.proveedor) || {};
    const nombre = t(prov.razon_social || prov.nombre_comercial || p.proveedor_texto || p.proveedor);
    const numero = t(p.numero), fecha = fechaCorta(p.fecha), obs = t(p.observacion_pedido), empresa = t(datos && datos.empresa);
    const items = ((datos && datos.lineas) || []).map((l) => ({ producto: t(l.insumo || l.codigo), cantidad: cantidadTexto(l.cantidad), unidad: unidadDe(l, datos.unidades) }));
    const reenvio = Number(datos && datos.intento) > 1, detalleWa = !(datos && datos.detalleWhatsapp === false);
    // 2do envio = "REENVÍO", 3ro = "REENVÍO 2"...: asi la cola (que descarta lo identico del mismo dia) no confunde un reenvio con el envio anterior
    const marca = reenvio ? (Number(datos.intento) === 2 ? 'REENVÍO - ' : `REENVÍO ${Number(datos.intento) - 1} - `) : '';
    const asunto = `${marca}Pedido #${numero} - ${nombre}`.trim();

    const detalleCorreo = ['Producto | Cantidad | Unidad', ...items.map((i) => `${i.producto} | ${i.cantidad} | ${i.unidad || '—'}`)].join('\n');
    const cuerpoCorreo = [
      'Buen día,', '',
      `Compartimos nuestro pedido correspondiente a la fecha ${fecha}.`, '',
      `PEDIDO: ${numero}`, '',
      'Detalle:', '', detalleCorreo, '',
      ...(obs ? [`Observaciones: ${obs}`, ''] : []),
      'Agradecemos confirmar disponibilidad y fecha estimada de entrega.', '',
      'Saludos,', empresa,
    ].join('\n').replace(/\n+$/, '') + '\n';

    const textoWhatsapp = [
      'Hola, buen día.', '',
      `Compartimos el pedido #${numero}.`, '',
      `Fecha: ${fecha}`, '',
      ...(detalleWa ? ['Detalle:', '', ...items.map((i) => `• ${i.producto} — ${i.cantidad}${i.unidad ? ' ' + i.unidad : ''}`), ''] : []),
      ...(obs ? [`Observaciones: ${obs}`, ''] : []),
      'Por favor confirmar disponibilidad y fecha estimada de entrega.', '',
      'Muchas gracias.',
    ].join('\n');

    return { asunto, cuerpoCorreo, textoWhatsapp, items, nombre, numero, fecha };
  }

  // Enlace de WhatsApp Web/app con el mensaje YA escrito: la persona tiene que darle "enviar" (NO es un envio automatico).
  const enlaceWhatsapp = (numero57, texto) => `https://wa.me/${String(numero57).replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;

  // Ruta del PDF adjunto dentro del bucket "facturas" (el mismo que ya usa la web para subir PDFs)
  const rutaPdf = (numero) => `pedidos/${String(numero || 'pedido').replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`;

  // ---------------------------------------------------------------- ESTADOS
  const ETIQUETAS = {
    pendiente: 'PENDIENTE', enviando: 'ENVIANDO', enviado: 'ENVIADO', error: 'ERROR',
    enlace_generado: 'ENLACE ABIERTO — falta confirmar el envío en WhatsApp', confirmado_manual: 'ENVIADO (confirmado por el usuario)',
    aceptado: 'ENVIADO POR WHATSAPP BUSINESS (aceptado)',   // API oficial: WhatsApp acepto el mensaje con el PDF adjunto
  };
  const EXITO = new Set(['enviado', 'confirmado_manual', 'aceptado']);
  const mas = (a, b) => (String(b.creado_en || '').localeCompare(String(a.creado_en || '')) || (Number(b.id) || 0) - (Number(a.id) || 0));

  // El estado REAL de un correo lo dice la cola (el envio es asincrono: lo despacha el vigilante); agotado = error.
  function estadoCorreoDeCola(c) { return !c ? null : ({ pendiente: 'pendiente', enviando: 'enviando', enviado: 'enviado', error: 'error', agotado: 'error' })[c.estado] || null; }

  // envios: filas de pedido_envio del pedido;  colas: { id: fila de correo_cola }  -> { canal: {estado, etiqueta, error, fecha, destinatario, intentos} | null }
  function estadoPorCanal(envios, colas) {
    const out = { correo: null, whatsapp: null };
    for (const canal of ['correo', 'whatsapp']) {
      const del = (envios || []).filter((e) => e && e.canal === canal).sort(mas);
      if (!del.length) continue;
      const u = del[0], cola = canal === 'correo' && u.correo_cola_id != null && colas ? colas[u.correo_cola_id] : null;
      let estado = u.estado, error = u.error || null;
      const dc = estadoCorreoDeCola(cola);
      if (dc && u.estado !== 'error') { estado = dc; error = dc === 'error' ? (cola.ultimo_error || error) : error; }
      out[canal] = { estado, etiqueta: ETIQUETAS[estado] || String(estado).toUpperCase(), error, fecha: u.creado_en, destinatario: u.destinatario, intentos: del.length };
    }
    return out;
  }

  // Un error en un canal NO tumba el pedido: basta un canal con exito. Sin intentos = borrador.
  function estadoPedido(porCanal) {
    const l = ['correo', 'whatsapp'].map((c) => porCanal && porCanal[c]).filter(Boolean);
    if (!l.length) return 'BORRADOR';
    if (l.some((x) => EXITO.has(x.estado))) return 'ENVIADO';
    if (l.some((x) => x.estado === 'enviando')) return 'ENVIANDO';
    if (l.some((x) => x.estado === 'pendiente' || x.estado === 'enlace_generado')) return 'PENDIENTE DE ENVÍO';
    return 'ERROR DE ENVÍO';
  }

  // De los canales pedidos, los que YA tienen un envio vigente (no fallido): antes de repetirlos hay que preguntar "¿desea reenviarlo?"
  function canalesYaEnviados(porCanal, canales) {
    return (canales || []).filter((c) => porCanal && porCanal[c] && porCanal[c].estado !== 'error');
  }
  // Numero de intento del proximo envio de un canal (1 = primero). Solo cuentan los que SI salieron: uno que fallo antes de enviarse no es un "reenvio".
  const proximoIntento = (envios, canal) => (envios || []).filter((e) => e && e.canal === canal && e.estado !== 'error').length + 1;

  return { validarCorreo, validarWhatsapp, contacto, fechaCorta, cantidadTexto, unidadDe, armarMensajes, enlaceWhatsapp, rutaPdf,
    ETIQUETAS, estadoCorreoDeCola, estadoPorCanal, estadoPedido, canalesYaEnviados, proximoIntento };
});
