// ============================================================
//  banco_web/js/banco-utils.js  -  logica PURA del Banco de Facturas (sin DOM, sin red)
//  Se carga en la pagina (window.BancoUtils) y se prueba con node (tests/banco-utils.test.js).
//
//   D) FECHAS: "selladas desde/hasta" con la fecha de SELLADO (sellada_en) en hora Colombia.
//   C) NOMBRES de archivo del "ciclo completo":  PREFIJO_NUMERO NOMBRE DEL PROVEEDOR.pdf
//   E) CRUCE DIAN: solo facturas que estan en la DIAN y NO estan en el sistema.
//      CUFE primero; si no, NIT + prefijo + numero. Nunca solo el numero.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BancoUtils = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TZ = 'America/Bogota';   // Colombia: UTC-5 todo el ano (sin horario de verano)

  // ---------------------------------------------------------------- FECHAS (D)
  // timestamptz de la base -> 'YYYY-MM-DD' en HORA COLOMBIA. (Un sello a las 8 pm del 18
  // queda el 19 en UTC pero es 18 para el usuario.)
  function fechaColombia(ts) {
    if (!ts) return null;
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  const hoyColombia = (ahora) => fechaColombia(ahora || new Date());

  // Rango INCLUSIVO por dia calendario (YYYY-MM-DD compara bien como texto).
  // "Desde 18/09" incluye TODO el dia 18 y los posteriores; "hasta 18/09" incluye todo el 18.
  function enRangoFecha(fecha, desde, hasta) {
    if (!desde && !hasta) return true;
    if (!fecha) return false;
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  }
  const esSellada = (f) => f && (f.estado === 'sellada' || f.estado === 'pagada');

  // Selladas del rango: la fecha que cuenta es la del SELLO (sellada_en), no la de emision ni la de ingreso.
  function filtrarSelladas(facturas, o) {
    o = o || {};
    let sinFechaSello = 0;
    const lista = (facturas || []).filter((f) => {
      if (!esSellada(f)) return false;
      if (o.sedeId && f.sede_id !== Number(o.sedeId)) return false;
      if (o.conIngreso && !f.num_ingreso) return false;
      if (!f.archivo_pdf) return false;
      if (!o.desde && !o.hasta) return true;
      const dia = fechaColombia(f.sellada_en);
      if (!dia) { sinFechaSello++; return false; }
      return enRangoFecha(dia, o.desde, o.hasta);
    });
    return { lista, sinFechaSello };
  }
  function validarRango(desde, hasta) {
    if (desde && hasta && desde > hasta) return 'La fecha inicial es posterior a la final.';
    return null;
  }

  // ---------------------------------------------------------------- NOMBRES DE ARCHIVO (C)
  function limpiarNombre(s, max) {
    return String(s == null ? '' : s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ')
      .replace(/[. ]+$/, '').trim().slice(0, max || 60).trim();
  }
  const alnum = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9]/g, '');

  // prefijo y numero de una factura (usa prefijo/folio; si faltan, se separa "documento")
  function partesNumero(f) {
    let pref = alnum(f.prefijo).toUpperCase(), fol = alnum(f.folio);
    const doc = alnum(f.documento);
    if (!fol && doc) {
      const m = doc.match(/^([A-Za-z]*?)(\d.*)$/);
      if (m) { pref = pref || m[1].toUpperCase(); fol = m[2]; } else fol = doc;
    } else if (!pref && doc && fol && doc.toUpperCase().endsWith(fol.toUpperCase()) && doc.length > fol.length) {
      pref = doc.slice(0, doc.length - fol.length).toUpperCase();
    }
    return { prefijo: pref, folio: fol };
  }
  // "PREFIJO_NUMERO NOMBRE DEL PROVEEDOR.pdf"  (sin prefijo: "NUMERO NOMBRE.pdf")
  function nombreArchivoCiclo(f) {
    const { prefijo, folio } = partesNumero(f);
    const num = folio ? (prefijo ? `${prefijo}_${folio}` : folio) : `CUFE_${String(f.cufe || 'sin-cufe').slice(0, 12)}`;
    const prov = limpiarNombre(f.emisor || 'PROVEEDOR', 60);
    return limpiarNombre(`${num} ${prov}`, 120);
  }
  // Nunca sobrescribe: si el nombre ya se uso, agrega (2), (3)...  Devuelve el nombre con .pdf
  function nombreUnico(base, usados) {
    let n = base, i = 2;
    while (usados.has(n.toLowerCase())) n = `${base} (${i++})`;
    usados.add(n.toLowerCase());
    return n + '.pdf';
  }

  // ---------------------------------------------------------------- CRUCE DIAN (E)
  const soloDigitos = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  const normAlnum = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sinCeros = (s) => { const t = normAlnum(s); return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t; };
  const CUFE_MIN = 64;   // un CUFE/CUDE real tiene 96 caracteres; menos de 64 no es confiable
  const cufeValido = (c) => normAlnum(c).length >= CUFE_MIN;

  // claves por las que una factura del sistema puede reconocerse: NIT|PREFIJO|NUMERO
  function clavesDe(nit, prefijo, folio) {
    const n = soloDigitos(nit), p = normAlnum(prefijo), fo = sinCeros(folio);
    if (!n || !fo) return [];
    return [`${n}|${p}|${fo}`];
  }
  function clavesSistema(f) {
    const claves = new Set(clavesDe(f.nit_emisor, f.prefijo, f.folio));
    const doc = normAlnum(f.documento);
    if (doc) {   // por si prefijo/folio vinieron incompletos: se prueba tambien lo derivado de "documento"
      const m = doc.match(/^([A-Z]*?)(\d.*)$/);
      if (m) clavesDe(f.nit_emisor, m[1], m[2]).forEach((c) => claves.add(c));
    }
    return [...claves];
  }

  // Tipo de documento DIAN -> factura | nota_credito | nota_debito | otro
  function tipoDian(t) {
    const s = String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!s) return 'factura';   // sin columna de tipo: se asume factura (y se avisa)
    if (/nota.*credito/.test(s)) return 'nota_credito';
    if (/nota.*debito/.test(s)) return 'nota_debito';
    if (/factura/.test(s) && !/nota/.test(s)) return 'factura';
    return 'otro';
  }
  // Estados que NO se suben (no se inventa nada mas: solo se avisa)
  const estadoNoApto = (e) => /anulad|rechazad|invalid|cancelad/i.test(String(e || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

  // Filas del Excel/CSV de la DIAN -> registros. Detecta la fila de encabezados y las columnas por nombre.
  function interpretarTablaDian(rows) {
    if (!rows || rows.length < 2) return { error: 'El archivo no tiene datos.' };
    const norm = (h) => String(h == null ? '' : h).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    let hi = 0;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const hs = (rows[i] || []).map(norm);
      if (hs.some((h) => /cufe|cude/.test(h)) || (hs.some((h) => h === 'folio') && hs.some((h) => h === 'prefijo'))) { hi = i; break; }
    }
    const H = (rows[hi] || []).map(norm);
    const idx = (re) => H.findIndex((h) => re.test(h));
    const col = {
      cufe: idx(/cufe|cude/), folio: idx(/^folio$/), prefijo: idx(/^prefijo$/),
      nit: idx(/nit.*emisor|^nit$/), estado: idx(/^estado$/), emisor: idx(/nombre.*emisor|^emisor$/),
      total: idx(/^total$/), tipo: idx(/^tipo( de)? documento$|^tipo$/), fecha: idx(/fecha.*emisi/),
    };
    if (col.cufe < 0 && (col.folio < 0 || col.nit < 0)) {
      return { error: 'No encontre columnas para identificar las facturas (CUFE, o NIT Emisor + Folio) en el archivo de la DIAN.' };
    }
    const v = (cols, i) => (i >= 0 ? cols[i] : '');
    const registros = [];
    for (let r = hi + 1; r < rows.length; r++) {
      const cols = rows[r] || [];
      const reg = {
        cufe: normAlnum(v(cols, col.cufe)), prefijo: normAlnum(v(cols, col.prefijo)), folio: normAlnum(v(cols, col.folio)),
        nit: soloDigitos(v(cols, col.nit)), estado: String(v(cols, col.estado) || '').trim(), emisor: String(v(cols, col.emisor) || '').trim(),
        total: String(v(cols, col.total) || '').trim(), fecha: String(v(cols, col.fecha) || '').trim(), tipoTexto: String(v(cols, col.tipo) || '').trim(),
      };
      if (!reg.cufe && !reg.folio) continue;
      reg.tipo = tipoDian(reg.tipoTexto);
      reg.numero = reg.prefijo + reg.folio;
      registros.push(reg);
    }
    return { registros, columnas: col, sinColumnaTipo: col.tipo < 0, sinColumnaNit: col.nit < 0 };
  }

  // DIAN vs sistema. facturasSistema: TODAS las filas de la tabla facturas (cufe, nit_emisor, prefijo, folio, documento, tipo).
  function cruzarConSistema(registros, facturasSistema) {
    const porCufe = new Map(), porClave = new Map();
    for (const f of facturasSistema || []) {
      const c = normAlnum(f.cufe);
      if (c) porCufe.set(c, f);
      for (const k of clavesSistema(f)) { if (!porClave.has(k)) porClave.set(k, []); porClave.get(k).push(f); }
    }
    const out = { pendientes: [], yaEnSistema: [], posiblesDuplicados: [], notas: [], excluidasEstado: [], otrosDocumentos: [], sinDatos: [], repetidasEnArchivo: 0 };
    const vistos = new Set();
    for (const r0 of registros) {
      // el CUFE se normaliza aqui (mayusculas, solo letras/numeros): no depende de quien lea el archivo
      const r = Object.assign({}, r0, { cufe: normAlnum(r0.cufe) });
      // repetidas dentro del mismo Excel (mismo CUFE, o mismo NIT+numero cuando no hay CUFE)
      const idUnico = cufeValido(r.cufe) ? 'C:' + r.cufe : `N:${r.nit}|${r.prefijo}|${sinCeros(r.folio)}`;
      if (vistos.has(idUnico)) { out.repetidasEnArchivo++; continue; }
      vistos.add(idUnico);

      const encontrado = () => {
        if (cufeValido(r.cufe) && porCufe.has(r.cufe)) return { f: porCufe.get(r.cufe), via: 'cufe' };
        const cands = clavesDe(r.nit, r.prefijo, r.folio).flatMap((k) => porClave.get(k) || []);
        if (cands.length) return { f: cands[0], via: 'nit+numero', cands };
        return null;
      };
      if (r.tipo === 'nota_credito' || r.tipo === 'nota_debito') { const e = encontrado(); out.notas.push({ r, enSistema: !!e }); continue; }
      if (r.tipo === 'otro') { out.otrosDocumentos.push({ r }); continue; }
      if (estadoNoApto(r.estado)) { out.excluidasEstado.push({ r }); continue; }

      const e = encontrado();
      if (e && e.via === 'cufe') { out.yaEnSistema.push({ r, f: e.f, via: 'cufe' }); continue; }
      if (e && e.via === 'nit+numero') {
        // mismo NIT y numero pero otro CUFE: no se sube (seria duplicar) ni se ignora sin mirar
        const distinto = cufeValido(r.cufe) && e.cands.every((c) => cufeValido(c.cufe) && normAlnum(c.cufe) !== r.cufe);
        if (distinto) out.posiblesDuplicados.push({ r, f: e.f, motivo: 'mismo NIT y numero pero CUFE distinto' });
        else out.yaEnSistema.push({ r, f: e.f, via: 'nit+numero' });
        continue;
      }
      // no esta en el sistema. ¿Hay con que comparar de forma confiable?
      const puedeComparar = cufeValido(r.cufe) || clavesDe(r.nit, r.prefijo, r.folio).length > 0;
      if (!puedeComparar) { out.sinDatos.push({ r }); continue; }
      out.pendientes.push({ r, comparadaPor: cufeValido(r.cufe) ? (clavesDe(r.nit, r.prefijo, r.folio).length ? 'cufe+numero' : 'solo cufe') : 'nit+numero' });
    }
    out.resumen = {
      enArchivo: registros.length, pendientes: out.pendientes.length, yaEnSistema: out.yaEnSistema.length,
      posiblesDuplicados: out.posiblesDuplicados.length, notas: out.notas.length, excluidasEstado: out.excluidasEstado.length,
      otrosDocumentos: out.otrosDocumentos.length, sinDatos: out.sinDatos.length, repetidasEnArchivo: out.repetidasEnArchivo,
    };
    return out;
  }

  // CSV (separado por ; con BOM, como los que ya exporta la pagina)
  function csvPendientes(pendientes) {
    const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const filas = ['CUFE;Prefijo;Folio;N. Factura;NIT Emisor;Nombre Emisor;Total;Estado DIAN;Fecha Emision'];   // mismo orden de siempre; la fecha va al final
    for (const { r } of pendientes) filas.push([r.cufe, r.prefijo, r.folio, r.numero, r.nit, q(r.emisor), q(r.total), q(r.estado), r.fecha].join(';'));
    return '\ufeff' + filas.join('\n') + '\n';
  }

  return {
    TZ, fechaColombia, hoyColombia, enRangoFecha, esSellada, filtrarSelladas, validarRango,
    limpiarNombre, partesNumero, nombreArchivoCiclo, nombreUnico,
    normAlnum, soloDigitos, sinCeros, cufeValido, clavesSistema, tipoDian, estadoNoApto,
    interpretarTablaDian, cruzarConSistema, csvPendientes,
  };
});
