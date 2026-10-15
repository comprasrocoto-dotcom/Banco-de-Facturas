// ============================================================
//  dian-abierto.js  -  RECORDAR CUALES FACTURAS YA ABRISTE EN LA DIAN  (26/09/2026)
//  La DIAN no deja que un robot baje los PDF: la persona pulsa "Abrir en DIAN", baja el PDF a mano y el agente lo sube. Mientras el PDF no llega no hay forma de saber
//  cual ya bajaste y cual no, asi que el boton "Abrir en DIAN" se marca (color verde, "✓ Abierta") cuando lo pulsas y la fila se resalta. La marca se guarda en ESTE navegador
//  (localStorage, por CUFE); si el navegador no deja guardar, dura mientras la pagina este abierta. Se puede quitar con ↺. Cuando llega el PDF el boton desaparece como siempre.
//  Logica pura (el almacenamiento se inyecta) + funciones de pagina al final. Se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DianAbierto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CLAVE = 'dian_abiertos_v1', MAX = 800;
  const norm = (c) => String(c == null ? '' : c).toLowerCase().replace(/[^0-9a-f]/g, '');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // alm = { getItem, setItem } (localStorage) o null/roto: entonces solo se recuerda en memoria durante la sesion
  function crear(alm) {
    let mem = null;
    const leer = () => {
      if (mem) return mem;
      let o = {}; try { const t = alm && alm.getItem(CLAVE); const j = t ? JSON.parse(t) : {}; if (j && typeof j === 'object' && !Array.isArray(j)) o = j; } catch (e) { o = {}; }
      mem = o; return mem;
    };
    const guardar = () => {
      const o = leer(), k = Object.keys(o);
      if (k.length > MAX) k.sort((a, b) => o[a] - o[b]).slice(0, k.length - MAX).forEach((x) => { delete o[x]; });   // se conservan las MAX mas recientes
      try { if (alm) alm.setItem(CLAVE, JSON.stringify(o)); } catch (e) { /* sin almacenamiento: queda en memoria */ }
    };
    return {
      esta: (cufe) => !!leer()[norm(cufe)],
      marcar: (cufe) => { const c = norm(cufe); if (!c) return; leer()[c] = Date.now(); guardar(); },
      quitar: (cufe) => { delete leer()[norm(cufe)]; guardar(); },
      cuantas: () => Object.keys(leer()).length,
    };
  }

  const ESTILO_ABIERTA = 'background:#dcfce7;border-color:#16a34a;color:#166534;font-weight:700';
  // HTML del boton (y del ↺ para quitar la marca cuando ya esta abierta). url = enlace oficial de la DIAN con el CUFE.
  // (06/10/2026) bf = datos de la factura para el favorito ⚡ DIAN BOT (js/favorito-dian.js): al pulsar se copian al portapapeles.
  // (06/10/2026) con datos, el enlace lleva al final #bfdian=NIT|NUMERO|TIPO: la DIAN lo conserva al redirigir y la extension
  // de Chrome "Banco de Facturas - DIAN" (extension-dian/ del agente) pone el NIT sola -> solo se pulsa Buscar y Descargar PDF
  function hashDian(bf) {
    const p = String(bf || '').split('|');
    if (p[0] !== 'BFDIAN' || !p[2]) return '';
    return '#bfdian=' + encodeURIComponent([p[2], p[3] || '', p[4] || 'factura'].join('|'));
  }
  function botonHtml(cufe, url, abierta, bf) {
    const c = esc(norm(cufe) || cufe);
    if (bf && url && url !== '#' && url.indexOf('#') < 0) url += hashDian(bf);
    return `<span class="dian-abrir" data-cufe="${c}" style="display:inline-flex;gap:4px;align-items:center">` +
      `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" onclick="dianMarcarAbierto('${c}',this)"${bf ? ` data-bf="${esc(bf)}"` : ''}>` +
      `<button class="${abierta ? '' : 's'}"${abierta ? ` style="${ESTILO_ABIERTA}"` : ''} title="${abierta ? 'Ya la abriste en la DIAN. Toca para abrirla de nuevo.' : 'Abre la DIAN con el CUFE ya escrito'}">${abierta ? '✓ Abierta · abrir de nuevo ↗' : 'Abrir en DIAN ↗'}</button></a>` +
      (abierta ? `<button title="Quitar la marca (dejarla como pendiente)" style="padding:4px 8px" onclick="dianDesmarcar('${c}',this)">↺</button>` : '') + '</span>';
  }

  // (15/10/2026) NIT que se escribe en la busqueda de la DIAN: el de NUESTRA EMPRESA (receptor; la marca a la que se cargo la
  // factura, ej. Rocoto), no el del proveedor. La DIAN acepta emisor o receptor. Orden: NIT receptor del reporte de la DIAN ->
  // NIT de la marca (marca_id) -> NIT del proveedor (como antes). Siempre sin digito de verificacion.
  //   d = { nit_receptor | nitReceptor, marca_id, nit }   nitsMarca = { [marca_id]: nit }
  function sinDv(n) {
    const s = String(n == null ? '' : n).trim();
    if (!s) return '';
    if (s.indexOf('-') >= 0) return s.split('-')[0].replace(/\D/g, '');
    const d = s.replace(/\D/g, '');
    return d.length === 10 && /^[89]/.test(d) ? d.slice(0, 9) : d;   // empresa: 9 digitos + DV pegado
  }
  function nitBusqueda(d, nitsMarca) {
    d = d || {};
    const rec = sinDv(d.nit_receptor || d.nitReceptor);
    if (rec.length >= 5) return rec;
    const mar = sinDv(nitsMarca && d.marca_id != null ? nitsMarca[d.marca_id] : '');
    if (mar.length >= 5) return mar;
    return sinDv(d.nit);
  }

  return { CLAVE, MAX, norm, crear, botonHtml, hashDian, ESTILO_ABIERTA, nitBusqueda, sinDv };
});

// ---------------------------------------------------------------- en la pagina
var DIAN_ABIERTO = (typeof DianAbierto !== 'undefined') ? DianAbierto.crear((function () { try { return window.localStorage; } catch (e) { return null; } })()) : null;
// d = { nit, numero, tipo } de la factura (opcional): con eso "Abrir en DIAN" deja los datos listos para el favorito ⚡ DIAN BOT
// (15/10/2026) el NIT que va a la DIAN es el de nuestra empresa (receptor / marca); ver DianAbierto.nitBusqueda
var DIAN_NITS_MARCA = {};
async function dianCargarNitsMarca() {
  try { const r = await SB.from('marcas').select('id,nit'); const m = {}; (r.data || []).forEach((x) => { if (x && x.nit) m[x.id] = x.nit; }); DIAN_NITS_MARCA = m; } catch (e) { /* sin NIT de marcas: se usa el del reporte o el del proveedor */ }
}
function dianNitEmpresa(d) { return DianAbierto.nitBusqueda(d, DIAN_NITS_MARCA) || String((d && d.nit) || ''); }
function dianDatosFavorito(cufe, d) {
  if (!d || typeof FavoritoDian === 'undefined') return '';
  const nit = DianAbierto.nitBusqueda(d, DIAN_NITS_MARCA) || d.nit;
  return FavoritoDian.datosPortapapeles(Object.assign({ cufe: cufe }, d, { nit: nit }));
}
function dianBotonHtml(cufe, d) { return DianAbierto.botonHtml(cufe, BancoUtils.urlDian(cufe), DIAN_ABIERTO.esta(cufe), dianDatosFavorito(cufe, d)); }
const dianBfDe = (span) => { try { const a = span && span.querySelector ? span.querySelector('a[data-bf]') : null; return a ? a.getAttribute('data-bf') : ''; } catch (e) { return ''; } };
// Repinta SOLO ese boton (y resalta/quita el resalte de su fila) sin volver a dibujar la lista; se hace despues del clic (setTimeout) para no quitar el enlace antes de que se abra
function dianRepintarBoton(span, cufe, abierta) {
  if (!span) return;
  const url = BancoUtils.urlDian(cufe);
  span.outerHTML = DianAbierto.botonHtml(cufe, url, abierta, dianBfDe(span));
}
function dianResaltarFila(el, abierta) { const f = el && el.closest ? el.closest('.row') : null; if (f) f.style.background = abierta ? '#f0fdf4' : ''; }
function dianMarcarAbierto(cufe, el) {
  DIAN_ABIERTO.marcar(cufe);
  // datos para el favorito ⚡ DIAN BOT (si el navegador no deja copiar, el favorito pide el NIT)
  const bf = el && el.getAttribute ? el.getAttribute('data-bf') : '';
  if (bf && typeof navigator !== 'undefined' && navigator.clipboard) { try { navigator.clipboard.writeText(bf).catch(() => {}); } catch (e) { /* sin portapapeles */ } }
  const span = el && el.closest ? el.closest('.dian-abrir') : null;
  setTimeout(() => { dianResaltarFila(span, true); dianRepintarBoton(span, cufe, true); }, 60);
}
function dianDesmarcar(cufe, el) {
  DIAN_ABIERTO.quitar(cufe);
  const span = el && el.closest ? el.closest('.dian-abrir') : null;
  dianResaltarFila(span, false); dianRepintarBoton(span, cufe, false);
}
