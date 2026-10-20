// ============================================================
//  menu-lateral.js  -  MENU LATERAL DE ICONOS estilo Hiopos (20/10/2026, pedido del usuario)
// ============================================================
// En computador el encabezado es una barra angosta de iconos (CSS «MENU LATERAL» en index.html). Al pasar el mouse o hacer
// clic en un icono sale un PANEL FLOTANTE con el nombre del modulo y sus pestañas (Facturas -> Sin asignar, Mias...).
// Cada pestaña del panel es un «espejo»: al pulsarla se abre el modulo (si hace falta) y se pulsa la pestaña original (la
// misma funcion de siempre). La sede se pone en una franja arriba del contenido. En celular nada de esto se usa.
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
  const ancho = window.matchMedia('(min-width:900px)');
  let fly = null, flyMod = '', cerrarT = null, programado = false;

  const limpio = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const nombre = (btn) => limpio(btn.textContent).replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/, '').replace(/\s*\(\d+\)\s*$/, '');
  const moduloActivo = () => { try { return typeof modulo !== 'undefined' && modulo ? String(modulo) : ''; } catch (e) { return ''; } };
  const clave = (el) => (el.id ? '#' + el.id : 'onclick:' + (el.getAttribute('onclick') || ''));
  function buscar(k) {
    if (k.startsWith('#')) return document.getElementById(k.slice(1));
    const oc = k.slice(8);
    return [...document.querySelectorAll('#app .wrap button.chip')].find((b) => (b.getAttribute('onclick') || '') === oc) || null;
  }
  // pestañas de un modulo (aunque el modulo no este abierto: las que existen y no estan escondidas a proposito)
  function pestanas(mod) {
    const sel = PESTANAS[mod]; if (!sel) return [];
    return [...document.querySelectorAll(sel)].filter((b) => b.style.display !== 'none')
      .map((b) => ({ k: clave(b), t: limpio(b.textContent), on: b.classList.contains('on') && moduloActivo() === mod }));
  }

  // ---------- panel flotante ----------
  function abrir(btn) {
    if (!ancho.matches || !btn) return;
    clearTimeout(cerrarT);
    const mod = btn.id.slice(2);
    if (!fly) {
      fly = document.createElement('div'); fly.id = 'menuFly';
      fly.addEventListener('mouseenter', () => clearTimeout(cerrarT));
      fly.addEventListener('mouseleave', cerrarLuego);
      document.body.appendChild(fly);
    }
    // marca el icono del panel (solo si cambia: cambiar la clase avisa al observador y no debe repetirse sin fin)
    document.querySelectorAll('#app>header .chip.vuela').forEach((b) => { if (b !== btn) b.classList.remove('vuela'); });
    if (!btn.classList.contains('vuela')) btn.classList.add('vuela');
    flyMod = mod;
    const tabs = pestanas(mod);
    fly.innerHTML = '';
    const tit = document.createElement('div'); tit.className = 'mf-tit'; tit.textContent = nombre(btn); tit.title = 'Abrir ' + nombre(btn);
    tit.addEventListener('click', () => { if (moduloActivo() !== mod) btn.click(); cerrar(); });
    fly.appendChild(tit);
    if (!tabs.length) {
      const it = document.createElement('button'); it.type = 'button'; it.className = 'mf-it' + (moduloActivo() === mod ? ' on' : '');
      it.textContent = 'Abrir ' + nombre(btn);
      it.addEventListener('click', () => { if (moduloActivo() !== mod) btn.click(); cerrar(); });
      fly.appendChild(it);
    }
    tabs.forEach((d) => {
      const it = document.createElement('button'); it.type = 'button'; it.className = 'mf-it' + (d.on ? ' on' : ''); it.textContent = d.t;
      it.addEventListener('click', () => {
        const ir = () => { const o = buscar(d.k); if (o) o.click(); };
        if (moduloActivo() !== mod) { btn.click(); setTimeout(ir, 60); } else ir();
        cerrar();
      });
      fly.appendChild(it);
    });
    // a la altura del icono, sin salirse de la pantalla
    const r = btn.getBoundingClientRect();
    fly.style.display = 'block'; fly.style.top = '0px';
    const alto = fly.offsetHeight, top = Math.max(8, Math.min(r.top, window.innerHeight - alto - 8));
    fly.style.top = top + 'px';
  }
  function cerrar() { clearTimeout(cerrarT); if (fly) fly.style.display = 'none'; flyMod = ''; document.querySelectorAll('#app>header .chip.vuela').forEach((b) => b.classList.remove('vuela')); }
  function cerrarLuego() { clearTimeout(cerrarT); cerrarT = setTimeout(cerrar, 280); }

  // ---------- la sede arriba del contenido (en computador) / en el encabezado (celular) ----------
  const IDS_SEDE = ['sede', 'fSede', 'caja_fmSede'];
  function ubicarSede() {
    const header = document.querySelector('#app > header'), wrap = document.querySelector('#app > .wrap');
    if (!header || !wrap) return;
    let barra = document.getElementById('barraSede');
    if (ancho.matches) {
      if (!barra) { barra = document.createElement('div'); barra.id = 'barraSede'; }
      if (barra.parentNode !== wrap || wrap.firstElementChild !== barra) wrap.insertBefore(barra, wrap.firstElementChild);
      IDS_SEDE.forEach((id) => { const e = document.getElementById(id); if (e && e.parentNode !== barra) barra.appendChild(e); });
    } else if (barra) {
      const sp = header.querySelector('.sp');
      IDS_SEDE.forEach((id) => { const e = document.getElementById(id); if (e && e.parentNode !== header) header.insertBefore(e, sp); });
    }
  }

  // ---------- numero sobre el icono (ej. Tareas (32)) y «Admin» activo ----------
  function refrescar() {
    programado = false;
    const header = document.querySelector('#app > header'); if (!header) return;
    const mod = moduloActivo();
    const ma = document.getElementById('m-admin'); if (ma && ma.classList.contains('on') !== (mod === 'admin')) ma.classList.toggle('on', mod === 'admin');
    header.querySelectorAll('button.chip[id^="m-"]').forEach((b) => {
      const m = limpio(b.textContent).match(/\((\d+)\)\s*$/), n = m ? m[1] : '';
      if ((b.getAttribute('data-n') || '') !== n) { if (n) b.setAttribute('data-n', n); else b.removeAttribute('data-n'); }
      if (!b.title) b.title = nombre(b);
    });
    // si el panel esta abierto, se actualiza (otra pestaña activa, conteos)
    if (fly && fly.style.display === 'block' && flyMod) { const b = document.getElementById('m-' + flyMod); if (b) abrir(b); }
  }
  function programar() { if (programado) return; programado = true; requestAnimationFrame(() => setTimeout(refrescar, 40)); }

  function iniciar() {
    const app = document.getElementById('app'), header = app && app.querySelector(':scope > header');
    if (!header) return;
    header.querySelectorAll('button.chip[id^="m-"]').forEach((b) => {
      b.addEventListener('mouseenter', () => abrir(b));
      b.addEventListener('mouseleave', cerrarLuego);
      b.addEventListener('click', () => setTimeout(() => abrir(b), 120));   // tras abrir el modulo, con sus pestañas ya pintadas
    });
    document.addEventListener('click', (e) => { if (fly && fly.style.display === 'block' && !fly.contains(e.target) && !e.target.closest('#app>header')) cerrar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
    new MutationObserver((ms) => { if (ms.some((m) => !(m.target.closest && m.target.closest('#menuFly')))) programar(); })
      .observe(app, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
    const alCambiar = () => { cerrar(); ubicarSede(); };
    if (ancho.addEventListener) ancho.addEventListener('change', alCambiar); else if (ancho.addListener) ancho.addListener(alCambiar);
    ubicarSede(); programar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
