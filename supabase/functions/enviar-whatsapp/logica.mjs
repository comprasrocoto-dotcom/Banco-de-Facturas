// ============================================================
//  logica.mjs  -  logica PURA de la Edge Function `enviar-whatsapp` (WhatsApp Business Cloud API, Meta)  (26/09/2026)
//  Sin red ni secretos: el telefono, la ruta del PDF y el cuerpo de la plantilla se arman y validan aqui, y se prueban con node (tests/whatsapp-api.test.js).
// ============================================================

export const VERSION_API = 'v21.0';

// Celular colombiano: 10 digitos que empiezan por 3 (con o sin 57). Puede venir mas de un numero: sirve el primer celular. -> '573001234567' | null
// (la MISMA regla que usa la web en js/envio-pedido.js: no se confia en el numero que mande el navegador, se toma del proveedor)
export function normalizarTelefono(texto) {
  const crudo = String(texto == null ? '' : texto).trim();
  if (!crudo) return null;
  for (const c of crudo.split(/[\/;,]|\s-\s|\sy\s/i).map((x) => x.trim()).filter(Boolean)) {
    let d = c.replace(/[^0-9]/g, '');
    if (d.startsWith('0057')) d = d.slice(4); else if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
    if (/^3[0-9]{9}$/.test(d)) return '57' + d;
  }
  return null;
}

// Solo se lee un PDF de pedidos del bucket: pedidos/<algo>.pdf (nada de rutas con ../ ni de otras carpetas)
export const rutaValida = (ruta) => /^pedidos\/[A-Za-z0-9._-]+\.pdf$/.test(String(ruta || '')) && !String(ruta).includes('..');

// Los parametros del cuerpo de una plantilla NO admiten saltos de linea, tabuladores ni mas de 3 espacios seguidos
export function limpiarParametro(texto, porDefecto) {
  const t = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim().slice(0, 300);
  return t || porDefecto || '-';
}

export function fechaCorta(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '').trim()); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ''); }

export function nombreArchivo(numero) { return `Pedido-${String(numero || 'pedido').replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`; }

// Mensaje de PLANTILLA con el PDF en el encabezado (un negocio solo puede escribirle primero a un cliente con una plantilla aprobada por Meta).
// Plantilla a crear en Meta (categoria Utilidad, encabezado tipo DOCUMENTO):
//   Hola, buen dia. Compartimos el pedido #{{1}} con fecha {{2}}. Observaciones: {{3}}. Por favor confirmar disponibilidad y fecha estimada de entrega. Muchas gracias.
export function armarPlantilla({ para, plantilla, idioma, mediaId, numero, fecha, observaciones }) {
  return {
    messaging_product: 'whatsapp',
    to: para,
    type: 'template',
    template: {
      name: plantilla,
      language: { code: idioma },
      components: [
        { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: nombreArchivo(numero) } }] },
        { type: 'body', parameters: [
          { type: 'text', text: limpiarParametro(numero) },
          { type: 'text', text: limpiarParametro(fechaCorta(fecha)) },
          { type: 'text', text: limpiarParametro(observaciones, 'Sin observaciones') },
        ] },
      ],
    },
  };
}

// Errores de Meta -> algo que se entienda. cuerpo = JSON de respuesta (o null)
export function interpretarErrorMeta(status, cuerpo) {
  const e = (cuerpo && cuerpo.error) || {}, code = Number(e.code), sub = Number(e.error_subcode);
  const det = String((e.error_data && e.error_data.details) || e.message || '').slice(0, 200);
  if (code === 190 || status === 401) return 'La clave de acceso de WhatsApp Business venció o no es válida: hay que generar un token nuevo en Meta y actualizarlo en Supabase.';
  if (code === 131030) return 'Ese número no está en la lista de destinatarios permitidos (cuenta en modo de prueba de Meta).';
  if (code === 131026) return 'Ese número no tiene WhatsApp o no se le pudo entregar el mensaje.';
  if (code === 132001) return 'La plantilla de WhatsApp no existe o no está aprobada con ese nombre e idioma.';
  if (code === 132000 || code === 132005 || code === 132007 || code === 132012) return 'La plantilla de WhatsApp no coincide con lo que se envió (parámetros o formato): ' + det;
  if (code === 131042) return 'La cuenta de WhatsApp Business tiene un problema de pago en Meta.';
  if (code === 130429 || code === 80007 || status === 429) return 'Meta limitó los envíos por un momento: intenta de nuevo en unos minutos.';
  if (code === 131056) return 'Se envió demasiado seguido al mismo número: espera un momento.';
  if (sub === 2494010 || /file|media/i.test(det) && code === 100) return 'WhatsApp rechazó el archivo PDF: ' + det;
  return `WhatsApp Business rechazó el envío${code ? ' (código ' + code + ')' : ''}: ${det || 'sin detalle'}`;
}
