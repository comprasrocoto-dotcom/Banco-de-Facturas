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
  function botonHtml(cufe, url, abierta) {
    const c = esc(norm(cufe) || cufe);
    return `<span class="dian-abrir" data-cufe="${c}" style="display:inline-flex;gap:4px;align-items:center">` +
      `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" onclick="dianMarcarAbierto('${c}',this)">` +
      `<button class="${abierta ? '' : 's'}"${abierta ? ` style="${ESTILO_ABIERTA}"` : ''} title="${abierta ? 'Ya la abriste en la DIAN. Toca para abrirla de nuevo.' : 'Abre la DIAN con el CUFE ya escrito'}">${abierta ? '✓ Abierta · abrir de nuevo ↗' : 'Abrir en DIAN ↗'}</button></a>` +
      (abierta ? `<button title="Quitar la marca (dejarla como pendiente)" style="padding:4px 8px" onclick="dianDesmarcar('${c}',this)">↺</button>` : '') + '</span>';
  }

  return { CLAVE, MAX, norm, crear, botonHtml, ESTILO_ABIERTA };
});

// ---------------------------------------------------------------- en la pagina
var DIAN_ABIERTO = (typeof DianAbierto !== 'undefined') ? DianAbierto.crear((function () { try { return window.localStorage; } catch (e) { return null; } })()) : null;
function dianBotonHtml(cufe) { return DianAbierto.botonHtml(cufe, BancoUtils.urlDian(cufe), DIAN_ABIERTO.esta(cufe)); }
// Repinta SOLO ese boton (y resalta/quita el resalte de su fila) sin volver a dibujar la lista; se hace despues del clic (setTimeout) para no quitar el enlace antes de que se abra
function dianRepintarBoton(span, cufe, abierta) {
  if (!span) return;
  const url = BancoUtils.urlDian(cufe);
  span.outerHTML = DianAbierto.botonHtml(cufe, url, abierta);
}
function dianResaltarFila(el, abierta) { const f = el && el.closest ? el.closest('.row') : null; if (f) f.style.background = abierta ? '#f0fdf4' : ''; }
function dianMarcarAbierto(cufe, el) {
  DIAN_ABIERTO.marcar(cufe);
  const span = el && el.closest ? el.closest('.dian-abrir') : null;
  setTimeout(() => { dianResaltarFila(span, true); dianRepintarBoton(span, cufe, true); }, 60);
}
function dianDesmarcar(cufe, el) {
  DIAN_ABIERTO.quitar(cufe);
  const span = el && el.closest ? el.closest('.dian-abrir') : null;
  dianResaltarFila(span, false); dianRepintarBoton(span, cufe, false);
}
