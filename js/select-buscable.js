// ============================================================
//  select-buscable.js  -  FILTROS DESPLEGABLES QUE SE BUSCAN ESCRIBIENDO  (06/10/2026)
//  Pedido del usuario: en Admin (Proveedores, Articulos, Catalogo completo) los filtros deben ser faciles de buscar: al
//  escribir, la lista se va filtrando con cada letra. Un <select data-buscable> se muestra como un campo de texto con su
//  lista: se escribe (sin importar tildes ni mayusculas, varias palabras a la vez) y se elige con clic o Enter.
//  El <select> ORIGINAL sigue ahi (oculto) con su value y su onchange: todo lo que ya lo usaba funciona igual. Si la pagina
//  vuelve a llenar las opciones, el campo se actualiza solo.
//  Logica pura arriba (se prueba con node) + enganche al DOM abajo.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SelectBuscable = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const plano = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  // ¿el texto tiene TODAS las palabras buscadas? (sin tildes ni mayusculas; "jua hoy" encuentra "JUAN D. HOYOS")
  function coincide(texto, q) {
    const palabras = plano(q).split(' ').filter(Boolean);
    if (!palabras.length) return true;
    const t = plano(texto), compacto = t.replace(/[\s.\-]/g, '');
    return palabras.every((p) => t.includes(p) || compacto.includes(p));
  }
  // opciones: [{ value, text }] -> las que coinciden, primero las que EMPIEZAN con lo escrito
  function filtrar(opciones, q) {
    const l = (opciones || []).filter((o) => coincide(o.text, q));
    const p = plano(q);
    if (!p) return l;
    return l.map((o, i) => ({ o, i, empieza: plano(o.text).startsWith(p) ? 0 : 1 })).sort((a, b) => a.empieza - b.empieza || a.i - b.i).map((x) => x.o);
  }
  return { plano, coincide, filtrar };
});

// ---------------------------------------------------------------- en la pagina
(function () {
  if (typeof document === 'undefined') return;
  const MAX = 300;   // opciones visibles a la vez (las listas largas se recorren escribiendo)
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function mejorar(sel) {
    if (!sel || sel.dataset.sbListo === '1') return;
    sel.dataset.sbListo = '1';
    const caja = document.createElement('span');
    caja.className = 'sb-caja';
    caja.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;' + (sel.style.width === '100%' ? 'width:100%;' : 'min-width:' + (sel.style.minWidth || '220px') + ';');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.autocomplete = 'off'; inp.className = 'sb-input';
    inp.placeholder = '🔎 escribe para buscar...';
    inp.style.cssText = 'width:100%;margin:0;box-sizing:border-box';
    const lista = document.createElement('div');
    lista.className = 'sb-lista';
    lista.style.cssText = 'display:none;position:absolute;left:0;right:0;top:100%;z-index:50;max-height:320px;overflow:auto;background:var(--card,#fff);border:1px solid var(--line,#cbd5e1);border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.18);margin-top:2px';
    inp.style.paddingRight = '26px';
    const flecha = document.createElement('span');   // que se note que tambien despliega una lista
    flecha.textContent = '▾'; flecha.setAttribute('aria-hidden', 'true');
    flecha.style.cssText = 'position:absolute;right:9px;top:50%;transform:translateY(-50%);pointer-events:none;color:#64748b;font-size:13px';
    sel.parentNode.insertBefore(caja, sel);
    caja.appendChild(inp); caja.appendChild(flecha); caja.appendChild(lista); caja.appendChild(sel);
    sel.style.display = 'none';
    let marcada = 0, abierta = false;
    const opciones = () => Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent }));
    const etiqueta = () => { const o = sel.options[sel.selectedIndex]; inp.value = o ? o.textContent : ''; inp.title = inp.value; };
    function pintar(q) {
      const l = SelectBuscable.filtrar(opciones(), q);
      marcada = Math.min(marcada, Math.max(0, l.length - 1));
      lista.innerHTML = l.length
        ? l.slice(0, MAX).map((o, i) => `<div class="sb-op" data-v="${esc(o.value)}" style="padding:7px 10px;cursor:pointer;${i === marcada ? 'background:#e0f2fe;' : ''}${o.value === sel.value ? 'font-weight:700;' : ''}">${esc(o.text)}</div>`).join('') +
          (l.length > MAX ? `<div class="mut" style="padding:6px 10px">… y ${l.length - MAX} más: sigue escribiendo</div>` : '')
        : '<div class="mut" style="padding:8px 10px">Nada coincide con lo escrito</div>';
      return l;
    }
    function abrir() { abierta = true; lista.style.display = 'block'; marcada = 0; pintar(''); inp.select(); }
    function cerrar() { abierta = false; lista.style.display = 'none'; etiqueta(); }
    function elegir(v) {
      cerrar();
      if (v == null || v === sel.value) { etiqueta(); return; }
      sel.value = v; etiqueta();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (document.activeElement === inp) inp.select();   // lo siguiente que se escriba reemplaza (no se suma al nombre)
    }
    inp.addEventListener('focus', abrir);
    inp.addEventListener('mousedown', () => { if (document.activeElement === inp && !abierta) setTimeout(abrir, 0); });
    inp.addEventListener('input', () => { if (!abierta) { abierta = true; lista.style.display = 'block'; } marcada = 0; pintar(inp.value); });
    inp.addEventListener('keydown', (e) => {
      if (!abierta && (e.key === 'ArrowDown' || e.key === 'Enter')) { abrir(); e.preventDefault(); return; }
      const l = SelectBuscable.filtrar(opciones(), inp.value === (sel.options[sel.selectedIndex] || {}).textContent ? '' : inp.value);
      if (e.key === 'ArrowDown') { marcada = Math.min(marcada + 1, l.length - 1); pintar(inp.value); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { marcada = Math.max(marcada - 1, 0); pintar(inp.value); e.preventDefault(); }
      else if (e.key === 'Enter') { if (l[marcada]) elegir(l[marcada].value); e.preventDefault(); }
      else if (e.key === 'Escape') { cerrar(); inp.blur(); }
    });
    lista.addEventListener('mousedown', (e) => { const op = e.target.closest('.sb-op'); if (op) { e.preventDefault(); elegir(op.dataset.v); } });
    inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp) cerrar(); }, 150));
    sel.addEventListener('change', etiqueta);
    new MutationObserver(() => { if (!abierta) etiqueta(); else pintar(inp.value); }).observe(sel, { childList: true, subtree: true, attributes: true });
    etiqueta();
  }
  function aplicar(raiz) { (raiz || document).querySelectorAll('select[data-buscable]').forEach(mejorar); }
  SelectBuscable.mejorar = mejorar; SelectBuscable.aplicar = aplicar;
  // cualquier <select data-buscable> que aparezca (las vistas se vuelven a pintar) se mejora solo
  const vigilar = () => {
    aplicar(document);
    new MutationObserver(() => aplicar(document)).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();
})();
