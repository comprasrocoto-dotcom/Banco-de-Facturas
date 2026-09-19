// ============================================================
//  pdf-desbloqueo-web.js  -  adaptador de NAVEGADOR del desbloqueo de PDF  (18/09/2026)
//  Mismo nucleo que el agente (js/pdf-desbloqueo-core.js). La herramienta qpdf (WebAssembly) se baja de la propia pagina
//  (js/vendor/qpdf-wasm/) SOLO cuando hace falta. Todo ocurre en el navegador: el PDF no sale a ningun servicio. Sin IA.
// ============================================================
(function (root) {
  'use strict';
  function crearDesbloqueadorWeb(opts) {
    opts = opts || {};
    const base = opts.base || 'js/vendor/qpdf-wasm/';
    let fabrica = null, cargando = null;

    function cargarHerramienta() {
      if (fabrica) return Promise.resolve(fabrica);
      if (cargando) return cargando;
      cargando = new Promise((ok, fallo) => {
        const s = document.createElement('script');
        s.src = base + 'qpdf.js';
        s.onload = () => { if (typeof root.Module === 'function') { fabrica = root.Module; ok(fabrica); } else fallo(new Error('la herramienta de desbloqueo no se cargó bien')); };
        s.onerror = () => { cargando = null; fallo(new Error('no se pudo cargar la herramienta de desbloqueo (' + base + 'qpdf.js)')); };
        document.head.appendChild(s);
      });
      return cargando;
    }

    async function ejecutar(args, archivos) {
      const crear = await cargarHerramienta();
      const so = [], se = [];
      const q = await crear({
        locateFile: (p) => base + p, noInitialRun: true,
        preRun: [(m) => { m.FS.init(() => null, (c) => { if (c !== null) so.push(c); }, (c) => { if (c !== null) se.push(c); }); }],
      });
      for (const n of Object.keys(archivos || {})) q.FS.writeFile(n, archivos[n]);
      let rc; try { rc = q.callMain(args); } catch (e) { rc = (e && e.status != null) ? e.status : -1; }
      const txt = (a) => new TextDecoder('utf-8').decode(new Uint8Array(a));
      return { rc, out: txt(so), err: txt(se), leer: (n) => { try { return new Uint8Array(q.FS.readFile(n)); } catch (e) { return null; } } };
    }

    const nucleo = root.PdfDesbloqueoCore.crearProcesador({
      disponible: true, ejecutar,
      aLatin1: (b) => { let t = ''; for (let i = 0; i < b.length; i += 8192) t += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return t; },
      hash: async (b) => { const d = await crypto.subtle.digest('SHA-256', typeof b === 'string' ? new TextEncoder().encode(b) : b); return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join(''); },
    });
    return { disponible: true, procesar: nucleo.procesar };
  }
  root.crearDesbloqueadorWeb = crearDesbloqueadorWeb;
})(typeof self !== 'undefined' ? self : this);
