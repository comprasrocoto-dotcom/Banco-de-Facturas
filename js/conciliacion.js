// ============================================================
//  conciliacion.js  -  DIAN <-> WEB <-> ERP   (18/09/2026)
//  Logica PURA y DETERMINISTA (sin red, sin base, sin IA): los mismos datos dan SIEMPRE el mismo resultado.
//  Reutiliza banco-utils.js (interpretarTablaDian / cruzarConSistema) para la parte DIAN <-> Web.
//
//  Fuentes:  DIAN (Excel)  ·  WEB (tabla facturas + modulo Pedidos)  ·  ERP (reporte "Documentos" de Hiopos, columna Su Doc)
//  Regla de oro: NUNCA se compara solo por el numero. Siempre numero + proveedor (o CUFE).
//  Un error de consulta / falta de datos NUNCA se convierte en "pendiente": queda como ERROR_DE_CONCILIACION o REVISAR.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./banco-utils.js'));
  else root.Conciliacion = factory(root.BancoUtils);
})(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';

  const RESULTADO = {
    INGRESADA: 'INGRESADA', PENDIENTE: 'PENDIENTE_DE_INGRESO', DUPLICADA: 'DUPLICADA', ANULADA: 'ANULADA',
    REVISAR: 'REVISAR', ERROR: 'ERROR_DE_CONCILIACION', APARTADO: 'PROVEEDOR_APARTADO',
  };
  const ETIQUETA = {
    INGRESADA: 'INGRESADA', PENDIENTE_DE_INGRESO: 'PENDIENTE DE INGRESO', DUPLICADA: 'DUPLICADA', ANULADA: 'ANULADA',
    REVISAR: 'REVISAR', ERROR_DE_CONCILIACION: 'ERROR DE CONCILIACIÓN', PROVEEDOR_APARTADO: 'PROVEEDOR APARTADO',
  };

  // ---------------------------------------------------------------- normalizacion
  const RE_MARCAS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  const sinTildes = (s) => String(s == null ? '' : s).normalize('NFD').replace(RE_MARCAS, '');
  const normAlnum = B.normAlnum;
  const digitosSinCeros = (d) => String(d).replace(/^0+(?=\d)/, '');

  // Numero de documento -> claves. fuerte = prefijo + numero sin ceros (FE-12548 = FE12548 = FE 12548 = fe012548);
  // debil = solo el numero (sirve unicamente como PISTA: siempre pide revision, nunca decide solo).
  function clavesDocumento(texto) {
    const a = normAlnum(texto);
    const out = { fuerte: new Set(), debil: new Set(), alnum: a };
    if (!a) return out;
    out.fuerte.add(a);
    const m = a.match(/^(.*?[A-Z])?(\d+)$/);
    if (m) {
      const pref = m[1] || '', num = digitosSinCeros(m[2]);
      out.fuerte.add(pref + num);
      out.debil.add(num);
    }
    return out;
  }
  // ¿el Su Doc trae un numero de factura util? ("PENDIENTE 02/09", "SIN FACTURA" o vacio = todavia no se sabe el numero)
  const tieneNumero = (texto) => !/PENDIENT|SIN\s*FACT|SIN\s*NUM|POR\s*LLEG/i.test(sinTildes(texto)) && /\d{2,}/.test(normAlnum(texto));

  // Nombre de proveedor -> palabras significativas (sin tildes, sin S.A.S./LTDA/S.A., sin conectores)
  function tokensNombre(s) {
    let t = ' ' + sinTildes(s).toUpperCase().replace(/&/g, ' Y ').replace(/[^A-Z0-9]+/g, ' ') + ' ';
    t = t.replace(/ S ?A ?S /g, ' ').replace(/ S ?C ?A /g, ' ').replace(/ E ?S ?P /g, ' ').replace(/ E ?U /g, ' ')
      .replace(/ S ?A /g, ' ').replace(/ LTDA /g, ' ').replace(/ LIMITADA /g, ' ').replace(/ CIA /g, ' ');
    return t.split(' ').filter((x) => x && !['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E'].includes(x));
  }
  const normalizarNombre = (s) => tokensNombre(s).join(' ');
  const nombreOrdenado = (s) => tokensNombre(s).sort().join(' ');

  // ¿el proveedor de la DIAN es el contacto del ERP?  'alias' (confirmado antes por una persona) > 'igual' > 'parecido' > null
  function compararProveedor(nit, nombreDian, nombreErp, aliasSet) {
    const n = B.soloDigitos(nit);
    if (aliasSet && n && aliasSet.has(n + '|' + normalizarNombre(nombreErp))) return 'alias';
    const a = tokensNombre(nombreDian), b = tokensNombre(nombreErp);
    if (!a.length || !b.length) return null;
    if (a.slice().sort().join(' ') === b.slice().sort().join(' ')) return 'igual';
    const sb = new Set(b), inter = a.filter((x) => sb.has(x)).length;
    const union = new Set(a.concat(b)).size;
    if (inter >= 2 && (inter / Math.min(a.length, b.length) >= 0.75 || inter / union >= 0.6)) return 'parecido';
    return null;
  }

  // ---------------------------------------------------------------- lector del reporte "Documentos" del ERP (Hiopos)
  // "145.500" -> 145500 ; "-18.320" -> -18320 ; "1.234,5" -> 1234.5
  function parseNumeroCo(v) {
    const t = String(v == null ? '' : v).trim();
    if (!t || !/\d/.test(t)) return 0;
    const n = Number(t.replace(/\./g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function fechaCoIso(v) {   // dd/mm/aaaa -> aaaa-mm-dd
    const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (!m) return null;
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const causacionDe = (serie, numero) => normAlnum(serie) + String(numero == null ? '' : numero).replace(/\D/g, '');   // "FCRC / 3423" -> FCRC3423

  // CSV (separado por ;, con o sin comillas) -> filas
  function csvATabla(texto) {
    const s = String(texto == null ? '' : texto).replace(/^﻿/, '');
    const sep = s.split('\n', 1)[0].includes(';') ? ';' : (s.split('\n', 1)[0].includes('\t') ? '\t' : ',');
    const filas = []; let fila = [], cel = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += c; }
      else if (c === '"') q = true;
      else if (c === sep) { fila.push(cel); cel = ''; }
      else if (c === '\n') { fila.push(cel.replace(/\r$/, '')); filas.push(fila); fila = []; cel = ''; }
      else cel += c;
    }
    if (cel.length || fila.length) { fila.push(cel.replace(/\r$/, '')); filas.push(fila); }
    return filas.filter((f) => f.some((x) => String(x).trim()));
  }

  // filas del reporte -> documentos del ERP
  function interpretarTablaErp(rows) {
    if (!rows || rows.length < 2) return { error: 'El archivo del ERP no tiene datos.' };
    const norm = (h) => sinTildes(h).trim().toLowerCase();
    let hi = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) { if ((rows[i] || []).map(norm).some((h) => h === 'su doc')) { hi = i; break; } }
    if (hi < 0) return { error: 'No encontre la columna "Su Doc" en el reporte del ERP. Debe ser el reporte "Documentos" de Hiopos (Serie / Número, Fecha Doc, Su Doc, Contacto, Neto).' };
    const H = rows[hi].map(norm), idx = (re) => H.findIndex((h) => re.test(h));
    const col = { serie: idx(/^serie/), fecha: idx(/^fecha/), suDoc: idx(/^su doc$/), contacto: idx(/^contacto$/), almacen: idx(/^almacen$/), base: idx(/^base$/), imp: idx(/^impuestos$/), neto: idx(/^neto$/), procesado: idx(/^procesado$/) };
    if (col.serie < 0 || col.suDoc < 0 || col.contacto < 0 || col.neto < 0) return { error: 'Al reporte del ERP le faltan columnas (Serie / Número, Su Doc, Contacto, Neto).' };
    const v = (c, i) => (i >= 0 ? String(c[i] == null ? '' : c[i]).trim() : '');
    const docs = []; const vistos = new Set(); let repetidos = 0, descartadas = 0;
    for (let r = hi + 1; r < rows.length; r++) {
      const c = rows[r] || [];
      const sn = v(c, col.serie).match(/^\*?\s*([A-Za-z]+)\s*\/\s*(\d+)\s*$/);
      if (!sn) { descartadas++; continue; }          // fila de totales u otra cosa
      const causacion = causacionDe(sn[1], sn[2]);
      if (vistos.has(causacion)) { repetidos++; continue; }
      vistos.add(causacion);
      const neto = parseNumeroCo(v(c, col.neto)), base = parseNumeroCo(v(c, col.base)), imp = parseNumeroCo(v(c, col.imp));
      const suDoc = v(c, col.suDoc), contacto = v(c, col.contacto);
      docs.push({
        causacion, serie: sn[1].toUpperCase(), numero: sn[2], fecha: fechaCoIso(v(c, col.fecha)), su_doc: suDoc, su_doc_clave: normAlnum(suDoc),
        contacto, contacto_norm: normalizarNombre(contacto), almacen: v(c, col.almacen), base, impuestos: imp, neto,
        tipo: neto < 0 ? 'nota_credito' : 'factura', procesado: /^(true|si|sí|1)$/i.test(v(c, col.procesado)),
      });
    }
    if (!docs.length) return { error: 'No encontre ningún documento en el reporte del ERP.' };
    const fechas = docs.map((d) => d.fecha).filter(Boolean).sort();
    return {
      docs, resumen: {
        total: docs.length, facturas: docs.filter((d) => d.tipo === 'factura').length, notas: docs.filter((d) => d.tipo === 'nota_credito').length,
        desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null, repetidos, descartadas,
        sinNumero: docs.filter((d) => !tieneNumero(d.su_doc)).length,
      },
    };
  }

  // ---------------------------------------------------------------- busqueda en el ERP
  function indexarErp(docs) {
    const fuerte = new Map(), debil = new Map(), sinNumero = [];
    for (const d of docs || []) {
      const k = clavesDocumento(d.su_doc);
      if (!tieneNumero(d.su_doc)) { sinNumero.push(d); continue; }   // "PENDIENTE 02/09", vacio, etc.
      for (const c of k.fuerte) { if (!fuerte.has(c)) fuerte.set(c, []); fuerte.get(c).push(d); }
      for (const c of k.debil) { if (!debil.has(c)) debil.set(c, []); debil.get(c).push(d); }
    }
    return { fuerte, debil, sinNumero };
  }
  const montoIgual = (total, d) => total != null && (Math.abs(Math.abs(d.neto) - Math.abs(total)) <= 1 || Math.abs(Math.abs(d.base + d.impuestos) - Math.abs(total)) <= 1);
  const signoOk = (tipo, d) => (tipo === 'nota_credito' ? d.neto < 0 : d.neto >= 0);

  // devuelve { exactas:[docs], probables:[{doc,por}] }
  function buscarEnErp(r, tipo, ctx) {
    const out = { exactas: [], probables: [] };
    if (!ctx.erpIdx) return out;
    const dk = clavesDocumento(r.prefijo + r.folio), yaVisto = new Set();
    const total = B.parseTotalDian(r.total);
    const evalua = (d, por) => {
      if (yaVisto.has(d.causacion) || !signoOk(tipo, d)) return;
      const rel = compararProveedor(r.nit, r.emisor, d.contacto, ctx.alias);
      if (!rel) return;
      yaVisto.add(d.causacion);
      const extra = montoIgual(total, d) ? ' · el monto coincide' : (total != null ? ' · el monto NO coincide (DIAN ' + total + ' / ERP ' + d.neto + ')' : '');
      if (por === 'fuerte' && (rel === 'alias' || rel === 'igual')) out.exactas.push({ doc: d, via: rel === 'alias' ? 'numero + proveedor confirmado' : 'numero + proveedor', extra });
      else out.probables.push({ doc: d, por: (por === 'fuerte' ? 'mismo numero, nombre de proveedor parecido' : por === 'debil' ? 'mismo numero sin prefijo' : 'sin numero en el ERP, mismo proveedor y monto') + extra });
    };
    for (const k of dk.fuerte) (ctx.erpIdx.fuerte.get(k) || []).forEach((d) => evalua(d, 'fuerte'));
    for (const k of dk.debil) (ctx.erpIdx.debil.get(k) || []).forEach((d) => evalua(d, 'debil'));
    if (!out.exactas.length) for (const d of ctx.erpIdx.sinNumero) if (montoIgual(total, d)) evalua(d, 'monto');
    return out;
  }

  // Pedidos de la web: {numero, proveedor_texto, nit_proveedor, factura_cufe, pedido_erp, numero_factura}
  function buscarEnPedidos(r, ctx) {
    const out = { exactas: [], probables: [] };
    const cufe = String(r.cufe || '').toLowerCase(), dk = clavesDocumento(r.prefijo + r.folio);
    for (const p of ctx.pedidos) {
      if (p.factura_cufe && String(p.factura_cufe).toLowerCase() === cufe && B.cufeValido(cufe)) { out.exactas.push({ p, via: 'cufe del pedido' }); continue; }
      const pk = clavesDocumento(p.numero_factura);
      if (![...pk.fuerte].some((k) => dk.fuerte.has(k))) continue;
      const nitP = B.soloDigitos(p.nit_proveedor);
      if (nitP && nitP === B.soloDigitos(r.nit)) { out.exactas.push({ p, via: 'numero + NIT del pedido' }); continue; }
      const rel = compararProveedor(r.nit, r.emisor, p.proveedor_texto, ctx.alias);
      if (rel === 'alias' || rel === 'igual') out.exactas.push({ p, via: 'numero + proveedor del pedido' });
      else if (rel === 'parecido') out.probables.push({ p, por: 'pedido con el mismo numero y nombre de proveedor parecido' });
    }
    return out;
  }

  // ---------------------------------------------------------------- proveedores que compras NO maneja
  // Se reconoce por NIT (si se conoce) o por nombre normalizado IGUAL. Nunca por "parecido": apartar de mas es peor que apartar de menos.
  function proveedorExcluido(r, excluidos) {
    const nit = B.soloDigitos(r.nit);
    for (const e of excluidos || []) {
      if (e.nit && nit && B.soloDigitos(e.nit) === nit) return { e, por: 'NIT' };
      if (e.nombre && compararProveedor(r.nit, r.emisor, e.nombre) === 'igual') return { e, por: 'nombre' };
    }
    return null;
  }
  // Para el cruce de siempre (panel "DIAN: Subir cruce"): saca de pendientes / duplicados / sin datos / notas a los proveedores apartados
  function apartarExcluidosCruce(cruce, excluidos) {
    cruce.apartados = [];
    if (!excluidos || !excluidos.length) return cruce;
    for (const k of ['pendientes', 'posiblesDuplicados', 'sinDatos', 'notas']) {
      cruce[k] = cruce[k].filter((x) => { const m = proveedorExcluido(x.r, excluidos); if (m) cruce.apartados.push({ r: x.r, de: k, por: m.por, nombre: m.e.nombre }); return !m; });
    }
    for (const k of ['pendientes', 'posiblesDuplicados', 'sinDatos', 'notas']) cruce.resumen[k] = cruce[k].length;
    cruce.resumen.apartados = cruce.apartados.length;
    return cruce;
  }

  // ---------------------------------------------------------------- conciliacion
  function construirContexto(fuentes) {
    // hay reporte del ERP si trae documentos, o si al menos se sabe desde que fecha cubre (consulta puntual sin resultados)
    const erp = fuentes.erp && Array.isArray(fuentes.erp.docs) && (fuentes.erp.docs.length || fuentes.erp.desde) ? fuentes.erp : null;
    const alias = new Set((fuentes.alias || []).map((a) => B.soloDigitos(a.nit) + '|' + (a.nombre_norm || normalizarNombre(a.nombre_erp))));
    const decisiones = new Map((fuentes.decisiones || []).map((d) => [String(d.cufe || '').toLowerCase(), d]));
    const fechas = erp ? erp.docs.map((d) => d.fecha).filter(Boolean).sort() : [];
    return {
      erp, erpIdx: erp ? indexarErp(erp.docs) : null, alias, decisiones, pedidos: fuentes.pedidos || [],
      desde: erp ? (erp.desde || fechas[0] || null) : null, hasta: erp ? (erp.hasta || fechas[fechas.length - 1] || null) : null,
      errores: fuentes.errores || {},
    };
  }

  function evaluar(r, tipo, web, ctx) {
    const fila = {
      r, cufe: String(r.cufe || '').toLowerCase(), tipo, documento: r.numero || (r.prefijo + r.folio), proveedor: r.emisor, nit: r.nit,
      fecha: B.fechaDianIso(r.fecha), total: B.parseTotalDian(r.total),
      dian: { estado: 'EN_DIAN' }, web, erp: { estado: 'NO_ESTA_EN_ERP' },
      resultado: null, accion: 'ninguna', motivo: '', causacion: null, factura_relacionada: null, candidatos: [], falta_pdf: false,
    };
    const dec = ctx.decisiones.get(fila.cufe) || null;
    if (dec && dec.factura_relacionada) fila.factura_relacionada = dec.factura_relacionada;
    const exactas = [];   // { fuente, causacion, detalle }
    const probables = [];
    if (dec && dec.decision === 'en_erp') exactas.push({ fuente: 'confirmada a mano', causacion: dec.causacion_erp || null, detalle: 'una persona confirmó que ya está en el ERP' + (dec.nota ? ' (' + dec.nota + ')' : '') });
    const er = buscarEnErp(r, tipo, ctx);
    er.exactas.forEach((x) => exactas.push({ fuente: 'reporte del ERP', causacion: x.doc.causacion, detalle: x.doc.causacion + ' · Su Doc ' + x.doc.su_doc.trim() + ' · ' + x.via + x.extra, doc: x.doc }));
    er.probables.forEach((x) => probables.push({ fuente: 'reporte del ERP', causacion: x.doc.causacion, detalle: x.doc.causacion + ' · Su Doc ' + x.doc.su_doc.trim() + ' · ' + x.doc.contacto + ' · ' + x.por, doc: x.doc }));
    if (web.f && web.f.num_ingreso) exactas.push({ fuente: 'banco (N° de ingreso)', causacion: normAlnum(web.f.num_ingreso), detalle: 'la factura del banco ya trae N° de ingreso ' + web.f.num_ingreso });
    const pe = buscarEnPedidos(r, ctx);
    for (const x of pe.exactas) { fila.web.pedido = x.p.numero; if (x.p.pedido_erp) exactas.push({ fuente: 'pedido de la web', causacion: normAlnum(x.p.pedido_erp), detalle: 'pedido ' + x.p.numero + ' ya creado en el ERP como ' + x.p.pedido_erp + ' (' + x.via + ')' }); }
    for (const x of pe.probables) { fila.web.pedido = fila.web.pedido || x.p.numero; if (x.p.pedido_erp) probables.push({ fuente: 'pedido de la web', causacion: normAlnum(x.p.pedido_erp), detalle: x.por + ' (pedido ' + x.p.numero + ', ' + x.p.pedido_erp + ')' }); }

    const fuenteOrden = ['confirmada a mano', 'reporte del ERP', 'banco (N° de ingreso)', 'pedido de la web'];
    exactas.sort((a, b) => fuenteOrden.indexOf(a.fuente) - fuenteOrden.indexOf(b.fuente));
    fila.candidatos = probables;

    if (exactas.length) {
      const e0 = exactas.find((x) => x.causacion) || exactas[0];
      fila.erp = { estado: 'EN_ERP', nivel: 'exacta', causacion: e0.causacion, fuente: e0.fuente, detalle: exactas.map((x) => x.detalle).join(' | ') };
      fila.causacion = e0.causacion;
      fila.resultado = RESULTADO.INGRESADA; fila.accion = 'ninguna';
      fila.motivo = 'Ya está en el ERP: ' + e0.detalle + (er.exactas.length > 1 ? ' · OJO: el ERP tiene ' + er.exactas.length + ' documentos con este mismo número y proveedor' : '');
      return fila;
    }
    if (probables.length && !(dec && dec.decision === 'no_esta')) {
      fila.erp = { estado: 'PROBABLE', nivel: 'probable', causacion: probables[0].causacion, fuente: probables[0].fuente, detalle: probables.map((x) => x.detalle).join(' | ') };
      fila.resultado = RESULTADO.REVISAR; fila.accion = 'revisar';
      fila.motivo = 'Parece estar en el ERP pero no es seguro: ' + probables[0].detalle + '. Confirma si es la misma o si no está.';
      return fila;
    }
    if (web.estado === 'DUPLICADA') {
      fila.resultado = RESULTADO.DUPLICADA; fila.accion = 'revisar';
      fila.motivo = 'Mismo NIT y número que una factura de la web pero con otro CUFE. No se sube: revisa cuál es la buena.';
      return fila;
    }
    const faltaFuente = !ctx.erp ? 'ERP (no hay reporte cargado)' : (ctx.errores.erp ? 'ERP (' + ctx.errores.erp + ')' : (ctx.errores.pedidos ? 'pedidos (' + ctx.errores.pedidos + ')' : (ctx.errores.excluidos ? 'lista de proveedores apartados (' + ctx.errores.excluidos + ')' : null)));
    if (faltaFuente) {
      fila.erp = { estado: 'ERROR', detalle: faltaFuente };
      fila.resultado = RESULTADO.ERROR; fila.accion = 'ninguna';
      fila.motivo = 'No se pudo comprobar en ' + faltaFuente + '. Una consulta fallida NO significa que no exista: no se sube.';
      return fila;
    }
    if (!(dec && dec.decision === 'no_esta') && ctx.desde && fila.fecha && fila.fecha < ctx.desde) {
      fila.erp = { estado: 'SIN_COBERTURA', detalle: 'el reporte del ERP empieza el ' + ctx.desde };
      fila.resultado = RESULTADO.REVISAR; fila.accion = 'revisar';
      fila.motivo = 'Emitida el ' + fila.fecha + ', antes de que empiece el reporte del ERP (' + ctx.desde + '): pudo ingresarse antes y no se ve. Confirma a mano.';
      return fila;
    }
    fila.resultado = RESULTADO.PENDIENTE; fila.accion = 'subir';
    fila.falta_pdf = web.estado === 'NO_ESTA_EN_WEB';
    fila.motivo = (fila.falta_pdf ? 'Está en la DIAN, no está en la web ni en el ERP.' : 'Está en la DIAN y en la web, pero NO en el ERP.') + (dec && dec.decision === 'no_esta' ? ' (una persona confirmó que NO está en el ERP)' : '');
    return fila;
  }

  // registros: salida de interpretarTablaDian. fuentes: { facturasWeb, pedidos, erp:{docs,desde,hasta,cargadoEn}, alias, decisiones, errores:{web,erp,pedidos} }
  function conciliar(registros, fuentes, opciones) {
    fuentes = fuentes || {}; opciones = opciones || {};
    const ctx = construirContexto(fuentes);
    const propios = (opciones.nitsPropios || []).map(B.soloDigitos);
    const apartados = [];
    if (!(fuentes.errores && fuentes.errores.excluidos) && (fuentes.excluidos || []).length) {
      registros = registros.filter((r) => {
        const nuestra = !propios.length || !r.nitReceptor || propios.includes(B.soloDigitos(r.nitReceptor));   // solo compras nuestras
        const m = nuestra && ['factura', 'nota_credito', 'nota_debito'].includes(r.tipo) ? proveedorExcluido(r, fuentes.excluidos) : null;
        if (m) apartados.push({ r, m });
        return !m;
      });
    }
    const cruce = B.cruzarConSistema(registros, fuentes.facturasWeb || [], { nitsPropios: opciones.nitsPropios });
    const filas = [];
    const webErr = fuentes.errores && fuentes.errores.web;
    const conWeb = (x, tipo, web) => {
      if (webErr) { filas.push(Object.assign(evaluar(x.r, tipo, { estado: 'ERROR', detalle: webErr }, ctx), {})); const f = filas[filas.length - 1]; if (f.resultado === RESULTADO.PENDIENTE || f.resultado === RESULTADO.REVISAR) { f.resultado = RESULTADO.ERROR; f.accion = 'ninguna'; f.motivo = 'No se pudo consultar la web (' + webErr + '). Una consulta fallida NO significa que no exista: no se sube.'; f.falta_pdf = false; } return; }
      filas.push(evaluar(x.r, tipo, web, ctx));
    };
    for (const x of cruce.pendientes) conWeb(x, x.r.tipo, { estado: 'NO_ESTA_EN_WEB' });
    for (const x of cruce.yaEnSistema) conWeb(x, x.r.tipo, { estado: 'EN_WEB', f: x.f, via: x.via });
    for (const x of cruce.posiblesDuplicados) conWeb(x, x.r.tipo, { estado: 'DUPLICADA', f: x.f });
    for (const x of cruce.notas) conWeb(x, x.r.tipo, x.enSistema ? { estado: 'EN_WEB', f: x.f, via: 'nit+numero/cufe' } : { estado: 'NO_ESTA_EN_WEB' });
    for (const x of cruce.excluidasEstado) {
      filas.push({ r: x.r, cufe: String(x.r.cufe || '').toLowerCase(), tipo: x.r.tipo, documento: x.r.numero, proveedor: x.r.emisor, nit: x.r.nit, fecha: B.fechaDianIso(x.r.fecha), total: B.parseTotalDian(x.r.total),
        dian: { estado: 'EN_DIAN' }, web: { estado: 'NO_APLICA' }, erp: { estado: 'NO_APLICA' }, resultado: RESULTADO.ANULADA, accion: 'ninguna', motivo: 'Estado en la DIAN: ' + (x.r.estado || '—'), causacion: null, factura_relacionada: null, candidatos: [], falta_pdf: false });
    }
    for (const x of cruce.sinDatos) {
      filas.push({ r: x.r, cufe: String(x.r.cufe || '').toLowerCase(), tipo: x.r.tipo, documento: x.r.numero, proveedor: x.r.emisor, nit: x.r.nit, fecha: B.fechaDianIso(x.r.fecha), total: B.parseTotalDian(x.r.total),
        dian: { estado: 'EN_DIAN' }, web: { estado: 'ERROR' }, erp: { estado: 'ERROR' }, resultado: RESULTADO.ERROR, accion: 'ninguna', motivo: 'Faltan datos (CUFE o NIT + número) para identificar el documento.', causacion: null, factura_relacionada: null, candidatos: [], falta_pdf: false });
    }
    for (const x of apartados) {
      filas.push({ r: x.r, cufe: String(x.r.cufe || '').toLowerCase(), tipo: x.r.tipo, documento: x.r.numero || (x.r.prefijo + x.r.folio), proveedor: x.r.emisor, nit: x.r.nit, fecha: B.fechaDianIso(x.r.fecha), total: B.parseTotalDian(x.r.total),
        dian: { estado: 'EN_DIAN' }, web: { estado: 'NO_APLICA' }, erp: { estado: 'NO_APLICA' }, resultado: RESULTADO.APARTADO, accion: 'ninguna', excluido_id: x.m.e.id || null,
        motivo: 'Proveedor apartado: lo maneja otra persona (' + x.m.e.nombre + ', reconocido por ' + x.m.por + '). No se sube ni se revisa aquí.', causacion: null, factura_relacionada: null, candidatos: [], falta_pdf: false });
    }
    filas.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || String(a.proveedor || '').localeCompare(String(b.proveedor || '')) || String(a.documento || '').localeCompare(String(b.documento || '')) || String(a.cufe).localeCompare(String(b.cufe)));
    return { filas, resumen: resumir(filas, cruce, ctx), cruce };
  }

  function resumir(filas, cruce, ctx) {
    const cuenta = (fn) => filas.filter(fn).length;
    const por = (tipo, res, extra) => cuenta((f) => f.tipo === tipo && f.resultado === res && (!extra || extra(f)));
    const tipos = ['factura', 'nota_credito', 'nota_debito'];
    const out = { porTipo: {}, enArchivo: cruce.resumen.enArchivo, emitidasPropias: cruce.resumen.emitidasPropias, otraEmpresa: cruce.resumen.otraEmpresa, otrosDocumentos: cruce.resumen.otrosDocumentos, repetidasEnArchivo: cruce.resumen.repetidasEnArchivo, erpDesde: ctx.desde, erpHasta: ctx.hasta };
    for (const t of tipos) {
      out.porTipo[t] = {
        total: cuenta((f) => f.tipo === t), ingresadas: por(t, RESULTADO.INGRESADA), pendientes: por(t, RESULTADO.PENDIENTE),
        porSubir: por(t, RESULTADO.PENDIENTE, (f) => f.falta_pdf), enWebSinIngreso: por(t, RESULTADO.PENDIENTE, (f) => !f.falta_pdf),
        apartados: por(t, RESULTADO.APARTADO), revisar: por(t, RESULTADO.REVISAR), duplicadas: por(t, RESULTADO.DUPLICADA), anuladas: por(t, RESULTADO.ANULADA), errores: por(t, RESULTADO.ERROR),
      };
    }
    return out;
  }

  // Lo que se puede mandar a "subir" (solo factura y nota credito; la nota debito no tiene lugar en el banco)
  function seleccionarParaCarga(filas, tipo) {
    return (filas || []).filter((f) => f.tipo === tipo && f.resultado === RESULTADO.PENDIENTE && f.falta_pdf && B.cufeValido(f.cufe));
  }
  // Justo antes de cada carga: se vuelve a conciliar ESE documento con datos recien leidos.
  function verificarAntesDeCargar(fila, fuentesFrescas, opciones) {
    const n = conciliar([fila.r], fuentesFrescas, opciones).filas[0];
    if (!n) return { ok: false, estado: 'ERROR_DE_CONSULTA', motivo: 'No se pudo volver a comprobar el documento.', fila };
    if (n.resultado === RESULTADO.PENDIENTE && n.falta_pdf) return { ok: true, fila: n };
    if (n.resultado === RESULTADO.INGRESADA) return { ok: false, estado: 'YA_EXISTE_EN_ERP', motivo: n.motivo, fila: n };
    if (n.resultado === RESULTADO.PENDIENTE) return { ok: false, estado: 'YA_EXISTE_EN_WEB', motivo: 'El PDF ya está en la web.', fila: n };
    if (n.resultado === RESULTADO.ERROR) return { ok: false, estado: 'ERROR_DE_CONSULTA', motivo: n.motivo, fila: n };
    return { ok: false, estado: n.resultado, motivo: n.motivo, fila: n };
  }

  // Con que buscar UN documento en las tablas (consulta puntual justo antes de cargar): numero (solo digitos) y nombres normalizados
  function criteriosConsulta(r) {
    const k = clavesDocumento(r.prefijo + r.folio);
    return { nit: B.soloDigitos(r.nit), digitos: [...k.debil][0] || '', contactoNorm: normalizarNombre(r.emisor), cufe: String(r.cufe || '').toLowerCase() };
  }

  // Fila para el registro de auditoria (tabla conciliacion_resultado)
  function filaAuditoria(f, momento) {
    const web = { EN_WEB: 'si', NO_ESTA_EN_WEB: 'no', DUPLICADA: 'duplicada', ERROR: 'error', NO_APLICA: 'no_aplica' }[f.web && f.web.estado] || 'no_aplica';
    const erp = { EN_ERP: 'si', NO_ESTA_EN_ERP: 'no', PROBABLE: 'probable', SIN_COBERTURA: 'sin_cobertura', ERROR: 'error', NO_APLICA: 'no_aplica' }[f.erp && f.erp.estado] || 'no_aplica';
    return {
      momento: momento || 'conciliacion', cufe: f.cufe || null, documento: f.documento || null, tipo: f.tipo, proveedor: f.proveedor || null, nit_emisor: f.nit || null,
      fecha_emision: f.fecha || null, res_dian: 'si', res_web: web, res_erp: erp, resultado: f.resultado, motivo: String(f.motivo || '').slice(0, 900), causacion_erp: f.causacion || null,
    };
  }

  return {
    RESULTADO, ETIQUETA, sinTildes, clavesDocumento, tieneNumero, tokensNombre, normalizarNombre, nombreOrdenado, compararProveedor,
    parseNumeroCo, fechaCoIso, causacionDe, csvATabla, interpretarTablaErp, indexarErp, buscarEnErp, buscarEnPedidos,
    proveedorExcluido, apartarExcluidosCruce, conciliar, seleccionarParaCarga, verificarAntesDeCargar, criteriosConsulta, filaAuditoria,
  };
});
