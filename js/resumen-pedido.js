// ============================================================
//  resumen-pedido.js  -  «🧾 Tu pedido»: resumen de lo que lleva el pedido, abajo en Nuevo pedido (14/10/2026, pedido del usuario)
// ============================================================
// En la barra de abajo (junto al Total y «Guardar pedido») se ve la lista de lo que ya tiene cantidad: articulo × cantidad
// (unidad), con ✕ para quitarlo. Se puede ocultar para que no tape la pantalla del celular. Logica pura + HTML.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ResumenPedido = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 });

  // cant: { codigo: cantidad } (npCant); lista: [{codigo, nombre, unidad}] (listaArticulos); libres: [{nombre, cant}] (articulos libres)
  // -> [{ codigo, nombre, cant, unidad, libre }] solo lo que tiene cantidad > 0, en el orden en que se agrego
  function armar(cant, lista, libres) {
    const porCod = new Map((lista || []).map((a) => [String(a.codigo), a]));
    const out = [];
    for (const cod of Object.keys(cant || {})) {
      const n = Number(cant[cod]); if (!(n > 0)) continue;
      const a = porCod.get(String(cod)) || {};
      out.push({ codigo: cod, nombre: a.nombre || cod, cant: n, unidad: a.unidad || '', libre: false });
    }
    for (const l of libres || []) { const n = Number(l.cant); if (n > 0 && String(l.nombre || '').trim()) out.push({ codigo: '', nombre: String(l.nombre).trim(), cant: n, unidad: '', libre: true }); }
    return out;
  }

  // la unidad solo si el nombre no la trae ya ("PAPA X KILO (KILO)")
  const unidadVisible = (it) => (it.unidad && !String(it.nombre).toUpperCase().includes('(' + String(it.unidad).toUpperCase() + ')') ? ' ' + it.unidad : '');

  // HTML del resumen. quitarFn / alternarFn: nombres globales de los manejadores de la pagina
  function html(items, abierto, quitarFn, alternarFn) {
    if (!(items && items.length)) return '';
    const cab = `<button type="button" class="np-res-cab" onclick="${alternarFn}()">🧾 Tu pedido: <b>${items.length}</b> artículo${items.length === 1 ? '' : 's'} ${abierto ? '▾ ocultar' : '▸ ver'}</button>`;
    if (!abierto) return `<div class="np-res">${cab}</div>`;
    const filas = items.map((it) => `<span class="np-res-it">${esc(it.nombre)} <b>× ${fmt(it.cant)}${esc(unidadVisible(it))}</b>${it.libre ? ' <span class="mut">(libre)</span>' : ` <button type="button" class="np-res-x" title="Quitar del pedido" onclick="${quitarFn}('${esc(it.codigo)}')">✕</button>`}</span>`).join('');
    return `<div class="np-res">${cab}<div class="np-res-lista">${filas}</div></div>`;
  }

  return { armar, html, unidadVisible };
});
