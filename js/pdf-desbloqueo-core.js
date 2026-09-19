// ============================================================
//  pdf-desbloqueo-core.js  -  nucleo del desbloqueo de PDF protegidos de la DIAN  (18/09/2026)
//  UN SOLO codigo para el agente (Node, lib/pdf-desbloqueo.js) y para la web (navegador, js/pdf-desbloqueo-web.js).
//  Deterministico, sin IA, sin red. La herramienta qpdf (WebAssembly) la entrega cada entorno con un "adaptador":
//     adaptador = { disponible, ejecutar(args, {ruta: bytes}) -> {rc, out, err, leer(ruta)}, aLatin1(bytes) -> texto, hash(bytes) -> Promise<hex> }
//
//  Reglas:
//   - UNA sola clave por documento (la que entrega el llamador: el NIT de la marca). NUNCA se prueban otras ni hay fuerza bruta.
//   - Un PDF que ya viene sin clave NO se reescribe (se valida y se deja igual).
//   - Nada se sube si no paso la validacion: abre, no pide clave, mismas paginas, mismo contenido, sin daños.
//   - La clave nunca queda en mensajes de error, logs ni resultados. El original no se toca (todo ocurre en memoria).
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfDesbloqueoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class ErrorPdf extends Error {
    constructor(codigo, mensaje) { super(mensaje); this.name = 'ErrorPdf'; this.codigo = codigo; }
  }

  function crearProcesador(adaptador) {
    const ejecutar = async (args, archivos) => {
      if (!adaptador.disponible) throw new ErrorPdf('SIN_HERRAMIENTA', 'falta la herramienta de desbloqueo');
      return adaptador.ejecutar(args, archivos);
    };
    const claveInvalida = (r) => /invalid password/i.test(r.err + r.out);
    const limpiar = (s, clave) => { let t = String(s || '').split('\n')[0].replace(/\/[a-z0-9]+\.pdf/gi, 'documento.pdf'); if (clave) t = t.split(clave).join('***'); return t.slice(0, 160); };
    const tieneEncrypt = (bytes) => /\/Encrypt\b/.test(adaptador.aLatin1(bytes));

    async function paginas(bytes, clave) {
      const r = await ejecutar((clave ? ['--password=' + clave] : []).concat(['--show-npages', '/x.pdf']), { '/x.pdf': bytes });
      const n = parseInt(String(r.out).trim(), 10);
      return r.rc === 0 && n > 0 ? n : 0;
    }
    // Datos decodificados del documento (contenido de cada pagina y de todos los streams) para compararlos antes y despues
    async function huellaContenido(bytes, clave) {
      const r = await ejecutar((clave ? ['--password=' + clave] : []).concat(['--json', '--json-stream-data=inline', '/x.pdf']), { '/x.pdf': bytes });
      if (r.rc !== 0 && r.rc !== 3) return null;
      let j; try { j = JSON.parse(r.out); } catch (e) { return null; }
      const objs = (j.qpdf && j.qpdf[1]) || {};
      const dato = async (ref) => { const o = objs['obj:' + ref]; return o && o.stream && o.stream.data ? (await adaptador.hash(o.stream.data)).slice(0, 16) : null; };
      const porPagina = [];
      for (const p of j.pages || []) { const h = []; for (const c of p.contents || []) h.push(await dato(c)); porPagina.push(h.join('+')); }
      const streams = [];
      for (const v of Object.values(objs)) if (v && v.stream && v.stream.data) streams.push((await adaptador.hash(v.stream.data)).slice(0, 16));
      streams.sort();
      return { porPagina, streams };
    }

    // bytes: PDF (Buffer o Uint8Array). o.clave: la unica clave a usar. o.alEtapa(nombre): aviso de progreso.
    // Devuelve { estado: 'SIN_CLAVE' | 'DESBLOQUEADO', bytes, paginas, intentos, protegido, advertencias } o lanza ErrorPdf.
    async function procesar(bytes, o) {
      o = o || {};
      const clave = o.clave ? String(o.clave) : '';
      const etapa = o.alEtapa || (() => {});
      if (!(bytes instanceof Uint8Array) || bytes.length < 100 || adaptador.aLatin1(bytes.subarray(0, 5)) !== '%PDF-') throw new ErrorPdf('PDF_CORRUPTO', 'el archivo no es un PDF (no empieza con %PDF-)');
      const dice = tieneEncrypt(bytes);

      // 1) ¿abre sin clave?
      const r0 = await ejecutar(['--check', '/in.pdf'], { '/in.pdf': bytes });
      const abreSinClave = r0.rc === 0 || r0.rc === 3;
      if (abreSinClave && !dice) {
        const n = await paginas(bytes);
        if (!n) throw new ErrorPdf('PDF_CORRUPTO', 'el PDF no tiene páginas legibles');
        return { estado: 'SIN_CLAVE', bytes, paginas: n, intentos: 0, protegido: false, advertencias: r0.rc === 3 };   // ya estaba abierto: no se toca
      }
      if (!abreSinClave && !claveInvalida(r0)) throw new ErrorPdf('PDF_CORRUPTO', 'el PDF está dañado: ' + limpiar(r0.err || r0.out, clave));
      etapa('PDF PROTEGIDO');

      // 2) desbloquear con LA clave de la marca (una sola vez). Si abre sin clave pero trae /Encrypt (clave de usuario vacia) se quita igual.
      const necesitaClave = !abreSinClave;
      if (necesitaClave && !clave) throw new ErrorPdf('CLAVE_INVALIDA', 'el PDF pide contraseña y no hay una configurada para esta marca');
      etapa('DESBLOQUEANDO');
      const args = (necesitaClave ? ['--password=' + clave] : []).concat(['--decrypt', '/in.pdf', '/out.pdf']);
      const d = await ejecutar(args, { '/in.pdf': bytes });
      if (claveInvalida(d)) throw new ErrorPdf('CLAVE_INVALIDA', 'contraseña no válida');
      const salida = d.leer('/out.pdf');
      if ((d.rc !== 0 && d.rc !== 3) || !salida || salida.length < 100) throw new ErrorPdf('PDF_CORRUPTO', 'no se pudo desbloquear el PDF: ' + limpiar(d.err || d.out, clave));
      etapa('PDF DESBLOQUEADO');

      // 3) VALIDAR el resultado (todo debe cumplirse; si algo falla NO se sube)
      const c = await ejecutar(['--check', '/out.pdf'], { '/out.pdf': salida });
      if ((c.rc !== 0 && c.rc !== 3) || !/not encrypted/i.test(c.out) || tieneEncrypt(salida)) throw new ErrorPdf('VALIDACION_FALLIDA', 'el PDF desbloqueado sigue protegido o tiene errores de estructura');
      const nOrig = await paginas(bytes, necesitaClave ? clave : ''), nNuevo = await paginas(salida);
      if (!nNuevo) throw new ErrorPdf('VALIDACION_FALLIDA', 'el PDF desbloqueado no tiene páginas legibles');
      if (nOrig !== nNuevo) throw new ErrorPdf('VALIDACION_FALLIDA', 'el PDF desbloqueado tiene ' + nNuevo + ' página(s) y el original ' + nOrig);
      const h1 = await huellaContenido(bytes, necesitaClave ? clave : ''), h2 = await huellaContenido(salida);
      if (!h1 || !h2) throw new ErrorPdf('VALIDACION_FALLIDA', 'no se pudo comprobar el contenido del PDF desbloqueado');
      if (JSON.stringify(h1.porPagina) !== JSON.stringify(h2.porPagina) || JSON.stringify(h1.streams) !== JSON.stringify(h2.streams)) throw new ErrorPdf('VALIDACION_FALLIDA', 'el contenido del PDF desbloqueado no coincide con el original');
      etapa('PDF VALIDADO');
      return { estado: 'DESBLOQUEADO', bytes: salida, paginas: nNuevo, intentos: 1, protegido: true, advertencias: c.rc === 3 };
    }
    return { disponible: !!adaptador.disponible, procesar };
  }

  return { ErrorPdf, crearProcesador };
});
