// ============================================================
//  menu-lateral.js  -  PESTAÑAS DEL MODULO dentro del menu lateral (20/10/2026, pedido del usuario)
// ============================================================
// En computador (menu lateral, ver el CSS «MENU LATERAL» en index.html), debajo del modulo activo salen sus pestañas:
// Facturas -> Sin asignar, Mias, Selladas...; Pedidos -> Pendientes, Facturados, Todos; Admin -> Proveedores, Articulos...
// Cada pestaña del menu es un «espejo»: al pulsarla se pulsa la pestaña original (la misma funcion de siempre) y se marca
// igual que ella. No cambia nada de los modulos; en celular no se ve (las pestañas siguen donde estaban).
(function () {
  'use strict';
  // modulo -> pestañas originales (selector dentro de la pagina)
  const PESTANAS = {
    banco: '#filtrosFacturas button.chip[id^="v-"]',
    pedidos: '#pe-pend, #pe-fact, #pe-todos',
    cruce: '#cruceRaiz button.chip[onclick^="cruceCambiaTab("], #cruceRaiz button.chip[onclick^="cruceOtrosTab("]',
    precios: '#preciosRaiz button.chip[onclick^="precFiltro(\'estado\'"]',
    eval: '#evalRaiz button.chip[onclick^="evTab("]',
    tareas: '#tareasRaiz button.chip[onclick^="tarVista("], #tareasRaiz button.chip[onclick^="TAR.filtroEstado="]',
    admin: '#vistaAdmin button.chip[id^="ad-"]',
  };
  let firma = '', programado = false;

  const visible = (el) => !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
  const clave = (el) => (el.id ? '#' + el.id : 'onclick:' + (el.getAttribute('onclick') || ''));
  function buscar(k) {
    if (k.startsWith('#')) return document.getElementById(k.slice(1));
    const oc = k.slice(8);
    return [...document.querySelectorAll('#app .wrap button.chip')].find((b) => (b.getAttribute('onclick') || '') === oc) || null;
  }

  function pintar() {
    programado = false;
    const header = document.querySelector('#app > header'); if (!header) return;
    // modulo activo: la variable «modulo» de la pagina (setModulo); si no, el boton marcado
    let mod = '';
    try { mod = typeof modulo !== 'undefined' && modulo ? String(modulo) : ''; } catch (e) { mod = ''; }
    if (!mod) { const on = [...header.querySelectorAll('button.chip[id^="m-"]')].find((b) => b.classList.contains('on')); mod = on ? on.id.slice(2) : ''; }
    const activo = document.getElementById('m-' + mod);
    // setModulo no marca «Admin» como activo: se marca aqui (solo la clase; no cambia nada mas)
    const ma = document.getElementById('m-admin'); if (ma && ma.classList.contains('on') !== (mod === 'admin')) ma.classList.toggle('on', mod === 'admin');
    const sel = PESTANAS[mod];
    const tabs = sel ? [...document.querySelectorAll(sel)].filter(visible) : [];
    const datos = tabs.map((b) => ({ k: clave(b), t: (b.textContent || '').replace(/\s+/g, ' ').trim(), on: b.classList.contains('on') }));
    const nueva = mod + '|' + JSON.stringify(datos);
    let caja = document.getElementById('menuSub');
    if (nueva === firma && caja && caja.previousElementSibling === activo) return;
    firma = nueva;
    if (!datos.length || !activo) { if (caja) caja.remove(); return; }
    if (!caja) { caja = document.createElement('div'); caja.id = 'menuSub'; }
    if (caja.previousElementSibling !== activo) activo.after(caja);
    caja.innerHTML = '';
    datos.forEach((d) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'menu-sub' + (d.on ? ' on' : ''); b.textContent = d.t; b.title = d.t;
      b.addEventListener('click', () => { const o = buscar(d.k); if (o) o.click(); programar(); });
      caja.appendChild(b);
    });
  }
  function programar() { if (programado) return; programado = true; requestAnimationFrame(() => setTimeout(pintar, 30)); }

  function iniciar() {
    const app = document.getElementById('app'); if (!app) return;
    // cualquier cambio en la pagina (otra pestaña, conteos, modulo) repinta el submenu; los cambios del propio submenu no cuentan
    new MutationObserver((ms) => { if (ms.some((m) => !(m.target.closest && m.target.closest('#menuSub')))) programar(); })
      .observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    programar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
