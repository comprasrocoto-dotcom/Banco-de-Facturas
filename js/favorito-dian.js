// ============================================================
//  favorito-dian.js  -  FAVORITO "⚡ DIAN BOT" PARA BAJAR LOS PDF DE LA DIAN CON MENOS CLICS  (06/10/2026)
//  Idea y flujo del bot DIAN asistido del usuario (E:\favorito_dian.js v2.0), adaptado al banco:
//   - "Abrir en DIAN" del banco deja en el portapapeles BFDIAN|CUFE|NIT|NUMERO|TIPO de esa factura.
//   - En la pagina de BUSQUEDA de la DIAN, un clic en el favorito pone el NIT (y el CUFE si falta), espera a que la
//     persona marque "Verifique que es un ser humano" y da Buscar.
//   - En el DETALLE, otro clic baja el PDF de cada pestaña (factura y, si tiene, su nota credito), esperando un captcha
//     nuevo para cada uno. El vigilante los reconoce por su CUFE y los sube solos al banco (la nota se amarra sola).
//  El captcha lo marca SIEMPRE la persona: el favorito solo espera a que este validado (no lo salta ni lo resuelve).
//  El codigo del favorito es la funcion bot(): se instala como "javascript:..." (sin comentarios de linea adentro).
//  En el banco solo se usa para armar el enlace a arrastrar (nunca se ejecuta en el banco). Se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FavoritoDian = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = '1.0';
  const PREFIJO = 'BFDIAN';

  // Lo que "Abrir en DIAN" deja en el portapapeles (sin saltos ni barras dentro de los campos)
  function datosPortapapeles(d) {
    const limpio = (s) => String(s == null ? '' : s).replace(/[|\r\n]+/g, ' ').trim();
    const nit = limpio(d && d.nit).split('-')[0].replace(/\D/g, '');   // la DIAN pide el NIT sin digito de verificacion
    return [PREFIJO, limpio(d && d.cufe).toLowerCase(), nit, limpio(d && d.numero), limpio(d && d.tipo) || 'factura'].join('|');
  }

  /* ======== EL FAVORITO: corre en la pagina de la DIAN, en el Chrome de la persona ======== */
  function bot() {
    (async function () {
      var VERSION_BOT = '@@VERSION@@';
      var URL_BUSCAR = 'https://catalogo-vpfe.dian.gov.co/User/SearchDocument';
      var WIDGET = '.cf-turnstile, iframe[src*="challenges.cloudflare.com"], input[name="cf-turnstile-response"]';
      var dormir = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var $ = function (s, r) { return (r || document).querySelector(s); };
      var todos = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
      var visible = function (el) { return !!(el && el.getClientRects && el.getClientRects().length); };
      var esc = function (s) { return String(s || '').replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };

      function aviso(html, color) {
        var d = $('#bfdian-aviso');
        if (!d) {
          d = document.createElement('div');
          d.id = 'bfdian-aviso';
          d.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;padding:12px 18px;border-radius:10px;' +
            'font:600 14px/1.45 Segoe UI,sans-serif;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.3);max-width:460px';
          document.body.appendChild(d);
        }
        d.style.background = color || '#0f766e';
        d.innerHTML = '<div style="font-size:12px;opacity:.85">⚡ DIAN BOT · Banco de Facturas v' + VERSION_BOT + '</div>' + html;
      }
      var nombreTipo = function (t) { return { factura: 'Factura', nota_credito: 'Nota crédito', nota_debito: 'Nota débito' }[t] || 'Documento'; };
      var tipoDeEtiqueta = function (s) { s = String(s || ''); return /cr[eé]dito/i.test(s) ? 'nota_credito' : (/d[eé]bito/i.test(s) ? 'nota_debito' : 'factura'); };

      async function leerPortapapeles() {
        try { return String(await navigator.clipboard.readText() || '').trim(); } catch (e) { return null; }
      }
      function tokenActual(r) {
        var i = $('input[name="cf-turnstile-response"]', r) || $('input[name="cf-turnstile-response"]');
        return i && i.value ? String(i.value) : '';
      }
      function reiniciarCaptcha() {
        try { if (window.turnstile && window.turnstile.reset) { window.turnstile.reset(); return true; } } catch (e) { }
        return false;
      }
      async function esperarCaptcha(r, usados, maxMs) {
        var t0 = Date.now(), reiniciado = false;
        while (Date.now() - t0 < maxMs) {
          var tk = tokenActual(r);
          if (tk && usados.indexOf(tk) < 0) return true;
          if (!$(WIDGET) && Date.now() - t0 > 4000) return true;
          if (tk && usados.indexOf(tk) >= 0 && !reiniciado && Date.now() - t0 > 2500) reiniciado = reiniciarCaptcha();
          await dormir(300);
        }
        return false;
      }
      var linkVisible = function () { return todos('a.downloadLink').filter(visible)[0] || null; };
      var panelDe = function (l) { return (l && l.closest && l.closest('.tab-pane, form, .panel, .card')) || document.body; };
      var pestanas = function () { return todos('.nav-tabs a, .nav-tabs button, [role="tab"]').filter(visible); };
      var urlPestana = function (t) { var h = t.getAttribute && t.getAttribute('href'); return h && h.charAt(0) !== '#' && !/^javascript:/i.test(h) ? t.href : ''; };
      function leerPanel(r, etiqueta) {
        var t = String((r && r.innerText) || '');
        var c = t.replace(/\s+/g, '').match(/[0-9a-fA-F]{96}/);
        var n = t.match(/(?:N[uú]mero|Folio|Prefijo y n[uú]mero)[^:\n]{0,20}:\s*([A-Z0-9-]{2,30})/i);
        return { cufe: c ? c[0].toLowerCase() : '', numero: n ? n[1] : '', tipo: tipoDeEtiqueta(etiqueta || t.slice(0, 300)) };
      }
      function errorVisible() {
        var e = todos('.validation-summary-errors, .field-validation-error, .alert-danger').filter(visible)[0];
        return e ? String(e.innerText || '').trim() : '';
      }

      /* ---------- pagina de busqueda ---------- */
      var campoCufe = $('#DocumentKey');
      if (campoCufe) {
        try { sessionStorage.removeItem('bfdian_paginas'); } catch (e) { }
        var txt = await leerPortapapeles();
        var p = (txt || '').split('|');
        if (p[0] !== 'BFDIAN' || p.length < 3) {
          var nit = prompt('No encontré los datos de la factura en el portapapeles.\nEn el banco da "Abrir en DIAN" a la factura (los copia solo) y vuelve a dar clic aquí,\no escribe el NIT del proveedor:', '');
          if (!nit) { aviso('Faltan los datos de la factura.<br>En el banco da <b>Abrir en DIAN</b> y vuelve a dar clic en ⚡ DIAN BOT.', '#c62828'); return; }
          p = ['BFDIAN', '', String(nit).replace(/\D/g, ''), '', ''];
        }
        var yaCufe = String(campoCufe.value || '').trim().toLowerCase();
        if (p[1] && /^[0-9a-f]{96}$/.test(yaCufe) && yaCufe !== p[1]) {
          aviso('Esta pestaña es de <b>otra factura</b> que la que copiaste.<br>En el banco vuelve a dar <b>Abrir en DIAN</b> a esta factura y luego clic aquí.', '#c62828');
          return;
        }
        var poner = function (el, v) {
          if (!el || !v) return;
          el.focus(); el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
        };
        if (!yaCufe && p[1]) poner(campoCufe, p[1]);
        poner($('#SearchDocumentNit'), p[2]);
        aviso(nombreTipo(p[4]) + ' <b>' + esc(p[3] || '') + '</b> lista (NIT puesto).<br>Esperando la verificación…<br><small>Si aparece la casilla "Verifique que es un ser humano", márcala.</small>');
        if (await esperarCaptcha(document.body, [], 180000)) {
          aviso('Verificación OK → Buscar', '#166534');
          var b = $('button.search-document') || $('button[type="submit"]');
          if (b) b.click();
          await dormir(4000);
          var err = errorVisible();
          if (err) aviso('La DIAN respondió: <b>' + esc(err.slice(0, 200)) + '</b>', '#c62828');
        } else {
          aviso('La verificación no se completó. Marca la casilla y da Buscar (o vuelve a dar clic en ⚡ DIAN BOT).', '#c62828');
        }
        return;
      }

      /* ---------- detalle del documento ---------- */
      if (!todos('a.downloadLink').length) {
        aviso('Aquí no hay nada para bajar.<br>Abre la factura desde el banco con <b>Abrir en DIAN</b>.', '#c62828');
        setTimeout(function () { if (confirm('¿Ir al buscador de la DIAN?')) location.href = URL_BUSCAR; }, 300);
        return;
      }
      aviso('Leyendo la página…');
      var tabs = pestanas();

      if (tabs.some(function (t) { return urlPestana(t); })) {
        var plan = {};
        try { plan = JSON.parse(sessionStorage.getItem('bfdian_paginas') || '{}'); } catch (e) { plan = {}; }
        plan.tipos = plan.tipos || [];
        var lkV = linkVisible(), rootV = panelDe(lkV), infoV = leerPanel(rootV, '');
        var otras = tabs.map(function (t) { return { etiqueta: String(t.innerText || '').trim(), url: urlPestana(t), tipo: tipoDeEtiqueta(t.innerText) }; })
          .filter(function (o) { return o.url && o.tipo !== infoV.tipo; });
        var lin = '• ' + nombreTipo(infoV.tipo) + ' <b>' + esc(infoV.numero || '') + '</b>';
        aviso(lin + '<br>Esperando la verificación para bajar el PDF…');
        if (!lkV || !(await esperarCaptcha(rootV, [], 180000))) { aviso(lin + '<br><b>La verificación no se completó.</b> Márcala y vuelve a dar clic en ⚡ DIAN BOT.', '#c62828'); return; }
        lkV.click();
        plan.tipos.push(infoV.tipo);
        var sig = otras.filter(function (o) { return plan.tipos.indexOf(o.tipo) < 0; })[0];
        await dormir(2500);
        if (sig) {
          plan.tipos.push(sig.tipo);
          try { sessionStorage.setItem('bfdian_paginas', JSON.stringify(plan)); } catch (e) { }
          aviso(lin + '<br>✓ Bajado.<br>También tiene <b>' + esc(sig.etiqueta) + '</b> en otra página: te llevo allá.<br><u>Da clic otra vez en ⚡ DIAN BOT</u> cuando cargue.', '#b45309');
          setTimeout(function () { location.href = sig.url; }, 3500);
        } else {
          try { sessionStorage.removeItem('bfdian_paginas'); } catch (e) { }
          aviso(lin + '<br>✓ Bajado. El vigilante lo sube solo al banco.<br>Ya puedes cerrar esta pestaña.', '#166534');
        }
        return;
      }

      var paneles = [];
      if (tabs.length) {
        for (var i = 0; i < tabs.length; i++) {
          tabs[i].click();
          await dormir(900);
          var lk = linkVisible();
          if (lk) paneles.push({ i: i, info: leerPanel(panelDe(lk), String(tabs[i].innerText || '')) });
        }
      } else {
        paneles.push({ i: -1, info: leerPanel(panelDe(linkVisible()), '') });
      }
      var hayNota = paneles.some(function (x) { return x.info.tipo !== 'factura'; });
      var lineas = paneles.map(function (x) { return '• ' + nombreTipo(x.info.tipo) + ' <b>' + esc(x.info.numero || '') + '</b>'; }).join('<br>');
      var color = hayNota ? '#b45309' : '#0f766e';
      aviso((paneles.length > 1 ? 'Esta página tiene ' + paneles.length + ' documentos:<br>' : '') + lineas + '<br>Esperando la verificación para bajar…', color);
      var usados = [], bajados = 0;
      for (var k = 0; k < paneles.length; k++) {
        if (paneles[k].i >= 0) { tabs[paneles[k].i].click(); await dormir(900); }
        var link = linkVisible();
        if (!link) continue;
        var r = panelDe(link);
        var ok = await esperarCaptcha(r, usados, k === 0 ? 180000 : 20000);
        if (!ok) {
          if (k === 0) { aviso(lineas + '<br><b>La verificación no se completó.</b> Márcala y vuelve a dar clic en ⚡ DIAN BOT.', '#c62828'); return; }
          aviso(lineas + '<br>Para el documento ' + (k + 1) + ' marca otra vez la casilla y da clic en ⚡ DIAN BOT.', '#b45309');
          return;
        }
        var tk = tokenActual(r);
        if (tk) usados.push(tk);
        link.click();
        bajados++;
        aviso(lineas + '<br>Bajando ' + bajados + '/' + paneles.length + '…', color);
        await dormir(k < paneles.length - 1 ? 3500 : 1500);
      }
      aviso(lineas + '<br>✓ ' + bajados + ' PDF bajado(s). El vigilante los sube solos al banco' + (hayNota ? ' (la nota crédito se amarra sola a su factura)' : '') + '.<br>Ya puedes cerrar esta pestaña.', '#166534');
    })();
  }

  // Codigo del favorito listo para instalar: sin comentarios de bloque, sin sangria. Los saltos de linea se conservan
  // (el codigo no depende de ellos para separar instrucciones: todo termina en ; o })
  function fuente() {
    const cuerpo = String(bot).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    return '(' + cuerpo.replace('@@VERSION@@', VERSION) + ')();';
  }
  const href = () => 'javascript:' + encodeURIComponent(fuente());

  // Texto de la ventana para instalarlo (el enlace se ARRASTRA a la barra de favoritos; un clic aqui no hace nada)
  function instruccionesHtml(enlace) {
    const e = String(enlace).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<h1>⚡ Favorito DIAN BOT <span class="mut" style="font-size:13px">v${VERSION}</span></h1>
<div class="mut" style="margin-bottom:8px">Baja los PDF de la DIAN con menos clics: pone el NIT, espera a que marques la verificación y da Buscar; en el detalle baja la factura y su nota crédito. El vigilante los sube solos al banco.</div>
<b>Instalarlo (una sola vez por navegador)</b>
<ol style="margin:6px 0 10px 18px;padding:0">
<li>Si ya tenías un favorito "⚡ DIAN BOT", <b>bórralo</b> (clic derecho → Eliminar).</li>
<li>Muestra la barra de favoritos: <b>Ctrl + Shift + B</b>.</li>
<li><b>Arrastra</b> este botón a la barra de favoritos:</li>
</ol>
<div style="text-align:center"><a href="${e}" onclick="alert('No le des clic aquí: arrástralo a la barra de favoritos.');return false;" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:10px;font-weight:800;font-size:18px;text-decoration:none;cursor:grab">⚡ DIAN BOT</a></div>
<b>Usarlo</b>
<ol style="margin:6px 0 10px 18px;padding:0">
<li>En el banco, <b>Abrir en DIAN</b> en la factura (eso copia sus datos).</li>
<li>En la búsqueda de la DIAN: clic en <b>⚡ DIAN BOT</b> → pone el NIT; marca "Verifique que es un ser humano" si aparece → da Buscar solo.</li>
<li>En el detalle: clic otra vez en <b>⚡ DIAN BOT</b> → baja el PDF de cada pestaña (factura y nota crédito).</li>
<li>Cierra la pestaña y sigue con la siguiente factura.</li>
</ol>
<div class="mut">La primera vez el navegador pide permiso para <b>leer el portapapeles</b> y para <b>descargar varios archivos</b> en la página de la DIAN: dale Permitir. La verificación de la DIAN la marcas tú: el favorito no la salta.</div>`;
  }

  return { VERSION, PREFIJO, datosPortapapeles, bot, fuente, href, instruccionesHtml };
});

// ---------------------------------------------------------------- en la pagina (banco)
function abrirFavoritoDian() {
  let m = document.getElementById('modalFavDian');
  if (!m) {
    m = document.createElement('div'); m.id = 'modalFavDian'; m.className = 'modal';
    m.onclick = (ev) => { if (ev.target === m) m.classList.remove('on'); };
    document.body.appendChild(m);
  }
  m.innerHTML = '<div class="card" style="max-width:560px">' + FavoritoDian.instruccionesHtml(FavoritoDian.href()) +
    '<div class="row" style="margin-top:10px"><span class="sp"></span><button onclick="document.getElementById(\'modalFavDian\').classList.remove(\'on\')">Cerrar</button></div></div>';
  m.classList.add('on');
}
const botonFavoritoDian = () => '<button class="s" title="Instala el favorito que llena el NIT y baja los PDF en la DIAN" onclick="abrirFavoritoDian()">⚡ Favorito DIAN BOT</button>';
