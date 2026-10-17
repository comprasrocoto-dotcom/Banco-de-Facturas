// logica.mjs  -  partes puras de la Edge Function `enviar-correos` (16/10/2026): armar el correo (MIME) y las direcciones.
// Misma forma que agent_factura_v2/enviar-correo.js (asunto en UTF-8 para los emojis, texto en base64, PDF adjunto opcional).
// Sin dependencias: la usan la funcion (Deno) y las pruebas (node).

const b64 = (texto) => {
  const bytes = typeof texto === 'string' ? new TextEncoder().encode(texto) : texto;
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const partir76 = (s) => s.replace(/(.{76})/g, '$1\r\n');

// "Nombre <a@b.com>, c@d.com" -> ['a@b.com', 'c@d.com'] (sin repetidos)
export function direcciones(...listas) {
  const out = [];
  for (const l of listas) for (const parte of String(l || '').split(/[,;]/)) {
    const m = parte.match(/<([^>]+)>/); const d = (m ? m[1] : parte).trim().toLowerCase();
    if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

// Punto al inicio de linea se duplica (RFC 5321) y todo termina en CRLF
export function cuerpoData(mime) {
  return String(mime).replace(/\r?\n/g, '\r\n').split('\r\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n');
}

// { de, para, cc, asunto, cuerpo, adjunto: { nombre, bytes(Uint8Array) } | null, fecha } -> texto MIME
export function armarMime({ de, para, cc, asunto, cuerpo, adjunto, fecha }) {
  const cab = [`From: Banco de Facturas <${de}>`, `To: ${para}`, ...(cc ? [`Cc: ${cc}`] : []), `Date: ${(fecha || new Date()).toUTCString()}`,
    `Subject: =?UTF-8?B?${b64(asunto || '')}?=`, 'MIME-Version: 1.0'];
  if (!adjunto) {
    return [...cab, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', partir76(b64(cuerpo || ''))].join('\r\n');
  }
  const nombre = String(adjunto.nombre || 'adjunto.pdf').replace(/["\r\n\\]/g, '_');
  const tipo = /\.pdf$/i.test(nombre) ? 'application/pdf' : 'application/octet-stream';
  const limite = '=_rocoto_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const n64 = b64(nombre);
  return [...cab, `Content-Type: multipart/mixed; boundary="${limite}"`, '',
    `--${limite}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', partir76(b64(cuerpo || '')),
    `--${limite}`, `Content-Type: ${tipo}; name="=?UTF-8?B?${n64}?="`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="=?UTF-8?B?${n64}?="`, '',
    partir76(b64(adjunto.bytes)), `--${limite}--`, ''].join('\r\n');
}

// el error que se guarda en la cola: nunca la clave
export function errorSeguro(e, clave) {
  let t = String((e && e.message) || e || 'error');
  if (clave) t = t.split(clave).join('***');
  return t.slice(0, 500);
}
