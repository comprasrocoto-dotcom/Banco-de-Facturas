// ============================================================
//  conversiones.js  -  MAXIMOS / MINIMOS EN UNIDAD DE COMPRA  (19/09/2026)
//   Los maximos y minimos viven en la UNIDAD DE INVENTARIO (maximos_minimos.subarticulo: GRAMOS, UNIDADES, ONZA, COPA...).
//   La web los muestra en la UNIDAD DE COMPRA del articulo (articulos.unimedida_compra: SIXPACK, BOLSAX500G, KILO...).
//   Ejemplo:  1 SIXPACK = 6 UND ;  minimo 6 UND -> 1 SIXPACK ;  maximo 12 UND -> 2 SIXPACK.
//
//  NO hay una tabla de conversiones nueva: se reutiliza lo que ya existia,
//    1) unidades_medida (formato -> medida + unidad): la conversion EXPLICITA. formato = la unidad de compra, p.ej. "SIXPACK"; medida/unidad = lo que trae (6 uds).
//    2) el mismo catalogo/alias y el mismo lector de presentaciones de lib/unidades.js ("BOLSAX500G", "CAJAX12UND", "UNDX22ONZ", "KILO"...).
//  Orden: explicita -> presentacion -> si no hay regla clara, NO convierte (nunca inventa): se muestra el numero de inventario, marcado.
//  Logica PURA y determinista (sin red, sin IA). La usa index.html y se prueba con node. Debe leer las presentaciones igual que lib/unidades.js
//  (hay una prueba de paridad en tests/conversiones.test.js).
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Conversiones = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- CATALOGO SEMILLA (igual que lib/unidades.js; se amplia con unidad_catalogo / unidad_alias de la base) ----------
  const CATALOGO_BASE = {
    KG: { nombre: 'Kilogramo', familia: 'masa', base: 'g', factor: 1000 }, G: { nombre: 'Gramo', familia: 'masa', base: 'g', factor: 1 },
    LB: { nombre: 'Libra', familia: 'masa', base: 'g', factor: 453.592 }, OZ: { nombre: 'Onza', familia: 'masa', base: 'g', factor: 28.3495 },
    L: { nombre: 'Litro', familia: 'volumen', base: 'ml', factor: 1000 }, ML: { nombre: 'Mililitro', familia: 'volumen', base: 'ml', factor: 1 },
    UND: { nombre: 'Unidad', familia: 'conteo', base: 'und', factor: 1 }, DOCENA: { nombre: 'Docena', familia: 'conteo', base: 'und', factor: 12 },
    CAJA: { nombre: 'Caja', familia: 'empaque' }, PAQUETE: { nombre: 'Paquete', familia: 'empaque' }, BOLSA: { nombre: 'Bolsa', familia: 'empaque' },
    TARRO: { nombre: 'Tarro', familia: 'empaque' }, BIDON: { nombre: 'Bidon', familia: 'empaque' }, GALON: { nombre: 'Galon', familia: 'empaque' },
    CANASTA: { nombre: 'Canasta', familia: 'empaque' }, BLOQUE: { nombre: 'Bloque', familia: 'empaque' }, BULTO: { nombre: 'Bulto', familia: 'empaque' },
    LATA: { nombre: 'Lata', familia: 'empaque' }, ROLLO: { nombre: 'Rollo', familia: 'empaque' }, BARRIL: { nombre: 'Barril', familia: 'empaque' },
    SIXPACK: { nombre: 'Sixpack', familia: 'empaque' }, BOTELLA: { nombre: 'Botella', familia: 'empaque' }, PACA: { nombre: 'Paca', familia: 'empaque' },
    GARRAFA: { nombre: 'Garrafa', familia: 'empaque' },
  };
  const ALIAS_BASE = {
    KG: ['KG', 'KGS', 'KILO', 'KILOS', 'KILOGRAMO', 'KILOGRAMOS', 'KL', 'K'], G: ['G', 'GR', 'GRS', 'GRAMO', 'GRAMOS'], LB: ['LB', 'LBS', 'LIBRA', 'LIBRAS'],
    OZ: ['OZ', 'ONZ', 'ONZA', 'ONZAS'], L: ['L', 'LT', 'LTS', 'LTR', 'LITRO', 'LITROS'], ML: ['ML', 'MLS', 'MILILITRO', 'MILILITROS', 'CC'],
    UND: ['UND', 'UNDS', 'UN', 'U', 'UNI', 'UNID', 'UNIDAD', 'UNIDADES', 'UDS', 'PC', 'PCS', 'PZA', 'PZAS', 'PIEZA', 'PIEZAS'], DOCENA: ['DOC', 'DOCENA', 'DOCENAS'],
    CAJA: ['CAJA', 'CAJAS', 'CJ', 'CJA'], PAQUETE: ['PAQUETE', 'PAQUETES', 'PAQ', 'PQT', 'PQTE'], BOLSA: ['BOLSA', 'BOLSAS', 'BLS'], TARRO: ['TARRO', 'TARROS'],
    BIDON: ['BIDON', 'BIDONES'], GALON: ['GALON', 'GALONES', 'GAL'], CANASTA: ['CANASTA', 'CANASTAS', 'CANASTILLA'], BLOQUE: ['BLOQUE', 'BLOQUES', 'BLQ'],
    BULTO: ['BULTO', 'BULTOS'], LATA: ['LATA', 'LATAS'], ROLLO: ['ROLLO', 'ROLLOS'], BARRIL: ['BARRIL', 'BARRILES'], SIXPACK: ['SIXPACK'],
    BOTELLA: ['BOTELLA', 'BOTELLAS', 'VBOTELLA'], PACA: ['PACA', 'PACAS'], GARRAFA: ['GARRAFA', 'GARRAFAS'],
  };
  // Sentido comun: por encima de estos valores la medida NO se acepta (probable error de digitacion).
  const MAX_PLAUSIBLE = { G: 50000, KG: 100, LB: 200, OZ: 500, ML: 20000, L: 250, UND: 2000, DOCENA: 100 };

  // ---------- TEXTO ----------
  function norm(t) {
    return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  }
  // Indice alias -> canon. Acepta filas de unidad_alias / unidad_catalogo de la base (mismo formato que lib/unidades.js).
  function construirIndice(aliasExtra, catalogoExtra) {
    const cat = Object.assign({}, CATALOGO_BASE);
    for (const c of (catalogoExtra || [])) {
      if (c && c.canon && c.familia) cat[c.canon] = { nombre: c.nombre, familia: c.familia, base: c.base || null, factor: c.factor_base != null ? Number(c.factor_base) : null };
    }
    const indice = new Map();
    for (const [canon, lista] of Object.entries(ALIAS_BASE)) for (const a of lista) indice.set(norm(a), canon);
    for (const r of (aliasExtra || [])) if (r && r.alias && r.canon && cat[r.canon] && r.activo !== false) indice.set(norm(r.alias), r.canon);
    indice.catalogo = cat;
    return indice;
  }
  let _base = null;
  const indiceBase = () => _base || (_base = construirIndice());

  // ---------- NUMEROS Y PRESENTACIONES (misma lectura que lib/unidades.js) ----------
  function parseNumero(tok, canon) {
    const t = String(tok);
    if (/^\d+$/.test(t)) return Number(t);
    const mil = t.match(/^(\d{1,3})([.,])(\d{3})$/);
    if (mil && ['G', 'ML', 'UND', 'OZ', 'DOCENA'].includes(canon)) return Number(mil[1] + mil[3]);
    const puntos = (t.match(/\./g) || []).length, comas = (t.match(/,/g) || []).length;
    if (puntos > 1 && comas === 0) return Number(t.replace(/\./g, ''));
    if (comas > 1 && puntos === 0) return Number(t.replace(/,/g, ''));
    if (puntos && comas) {
      const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',', mil2 = dec === '.' ? ',' : '.';
      return Number(t.split(mil2).join('').replace(dec, '.'));
    }
    return Number(t.replace(',', '.'));
  }
  function expandir(texto, indice) {
    let t = norm(texto).replace(/[*×]/g, ' X ').replace(/[^A-Z0-9.,]+/g, ' ');
    t = t.replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2');
    const out = [];
    for (let tk of t.split(/\s+/)) {
      tk = tk.replace(/^[.,]+|[.,]+$/g, '');
      if (!tk) continue;
      if (tk.length > 1 && tk.endsWith('X') && indice.has(tk.slice(0, -1))) out.push(tk.slice(0, -1), 'X');
      else out.push(tk);
    }
    return out;
  }
  const esNumero = (tk) => /^\d+(?:[.,]\d+)*$/.test(tk);
  const redondear = (n) => Math.round(n * 1e6) / 1e6;
  function interpretar(texto, indice) {
    indice = indice || indiceBase();
    const cat = indice.catalogo, toks = expandir(texto, indice);
    const medidas = [], explicitos = [], sinUnidad = [], motivos = [];
    let envase = null;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (esNumero(tk)) {
        const canon = toks[i + 1] ? indice.get(toks[i + 1]) : null;
        if (canon && cat[canon].familia !== 'empaque') {
          const cantidad = parseNumero(tk, canon), info = cat[canon];
          const plausible = cantidad > 0 && (MAX_PLAUSIBLE[canon] == null || cantidad <= MAX_PLAUSIBLE[canon]);
          medidas.push({ cantidad, canon, familia: info.familia, base_unit: info.base, base_qty: redondear(cantidad * info.factor), plausible, texto: `${tk} ${toks[i + 1]}` });
          i++;
        } else if (toks[i - 1] === 'X') sinUnidad.push(tk);
        continue;
      }
      const canon = indice.get(tk);
      if (canon) {
        const fam = cat[canon].familia;
        if ((fam === 'empaque' || canon === 'UND') && !envase) envase = canon;
        explicitos.push(canon);
      }
    }
    for (const m of medidas) if (!m.plausible) motivos.push(`medida no plausible: ${m.texto}`);
    return { toks, medidas, explicitos, sinUnidad, envase, motivos };
  }

  // ---------- CONVERSION ENTRE UNIDADES DEL CATALOGO ----------
  // Solo dentro de la misma familia (masa/volumen/conteo). Un empaque (SIXPACK, CAJA...) NUNCA se convierte sin un factor explicito.
  function convertir(cantidad, de, a, indice) {
    const cat = (indice || indiceBase()).catalogo;
    if (de === a) return { ok: true, valor: cantidad };
    const fd = cat[de], fa = cat[a];
    if (!fd || !fa) return { ok: false, motivo: 'unidad desconocida' };
    if (fd.familia !== fa.familia || fd.familia === 'empaque') return { ok: false, motivo: `no se puede pasar ${de} a ${a} sin un factor explícito` };
    return { ok: true, valor: redondear(cantidad * fd.factor / fa.factor) };
  }

  // ---------- UNIDAD DE INVENTARIO (maximos_minimos.subarticulo) ----------
  // GRAMOS -> G, UNIDADES -> UND, ONZA -> OZ. Lo que el catalogo no conoce (COPA) queda como esta: solo sirve con una conversion explicita.
  function unidadInventario(sub, indice) {
    indice = indice || indiceBase();
    const n = norm(sub); if (!n) return null;
    const canon = indice.get(n);
    if (canon) return { canon, catalogo: true, familia: indice.catalogo[canon].familia, etiqueta: n };
    return { canon: n, catalogo: false, familia: null, etiqueta: n };
  }

  // ---------- CONVERSION EXPLICITA (tabla unidades_medida) ----------
  // La llave es la unidad de compra sin espacios y con "*" = "X":  "CAJA*12UND" y "CAJAX12UND" son la misma.
  const claveFormato = (t) => norm(t).replace(/\s+/g, '').replace(/[*×]/g, 'X');
  function indexarTabla(filas, indice) {
    indice = indice || indiceBase();
    const m = new Map();
    for (const f of (filas || [])) {
      const k = claveFormato(f && f.formato), cant = Number(f && f.medida);
      if (!k || !(cant > 0)) continue;
      const u = norm(f.unidad), canon = indice.get(u) || u;
      m.set(k, { formato: f.formato, cantidad: cant, unidad: f.unidad, canon });
    }
    return m;
  }
  // Contexto que se arma una vez con lo que trae la base: { catalogo: unidad_catalogo[], alias: unidad_alias[], unidadesMedida: unidades_medida[] }
  function crearContexto(datos) {
    datos = datos || {};
    const indice = construirIndice(datos.alias, datos.catalogo);
    return { indice, tabla: indexarTabla(datos.unidadesMedida, indice) };
  }

  const no = (motivo) => ({ ok: false, motivo });
  const si = (factor, via, detalle) => ({ ok: true, factor: redondear(factor), via, detalle });

  // A cuantas unidades de INVENTARIO equivale UNA unidad de COMPRA. { ok, factor, via:'tabla'|'presentacion'|'nombre', detalle } | { ok:false, motivo }
  function resolverFactor(presentacion, subarticulo, ctx) {
    ctx = ctx || crearContexto();
    const indice = ctx.indice, txt = String(presentacion == null ? '' : presentacion).trim();
    if (!txt) return no('el artículo no tiene unidad de compra');
    const inv = unidadInventario(subarticulo, indice);
    if (!inv) return no('sin unidad de inventario');

    // 1) conversion explicita cargada por el usuario (unidades_medida)
    const fila = ctx.tabla && ctx.tabla.get(claveFormato(txt));
    let motivoTabla = null;
    if (fila) {
      const r = fila.canon === inv.canon ? { ok: true, valor: fila.cantidad } : (inv.catalogo && indice.catalogo[fila.canon] ? convertir(fila.cantidad, fila.canon, inv.canon, indice) : { ok: false });
      if (r.ok) return si(r.valor, 'tabla', `1 ${txt} = ${fila.cantidad} ${fila.unidad}`);
      motivoTabla = `la conversión cargada (${fila.cantidad} ${fila.unidad}) no sirve para ${inv.etiqueta}`;
    }
    // 2) lo que dice la propia presentacion
    const p = dePresentacion(txt, inv, indice);
    if (p.ok) return p;
    return no(motivoTabla || p.motivo);
  }

  function dePresentacion(txt, inv, indice) {
    const cat = indice.catalogo, it = interpretar(txt, indice);
    if (it.motivos.length) return no(it.motivos.join('; '));
    if (!inv.catalogo) return no(`para ${inv.etiqueta} hay que cargar la conversión`);
    // sin ninguna cantidad: solo vale si es el NOMBRE de una unidad medible (KILO, LIBRA, UNIDADES)
    if (!it.medidas.length) {
      if (it.sinUnidad.length) return no(`la presentación trae ${it.sinUnidad.join(', ')} sin unidad`);
      const canon = indice.get(norm(txt));
      if (!canon) return no('la presentación no dice cuánto trae');
      if (cat[canon].familia === 'empaque') return no(`${txt} es un empaque: falta cargar cuántas unidades trae`);
      const r = convertir(1, canon, inv.canon, indice);
      return r.ok ? si(r.valor, 'nombre', `1 ${txt} = ${r.valor} ${inv.etiqueta}`) : no(r.motivo);
    }
    const conteo = it.medidas.filter((m) => m.familia === 'conteo');
    const fisicas = it.medidas.filter((m) => m.familia === 'masa' || m.familia === 'volumen');
    if (inv.familia === 'conteo') {
      if (conteo.length === 1) { const r = convertir(conteo[0].cantidad, conteo[0].canon, inv.canon, indice); return r.ok ? si(r.valor, 'presentacion', `${txt} trae ${conteo[0].texto}`) : no(r.motivo); }
      if (conteo.length > 1) return no('la presentación trae varias cantidades de unidades');
      if (it.envase === 'UND') return si(1, 'presentacion', `${txt}: una unidad`);          // "UNDX500G" = una unidad de 500 g
      return no(`la presentación trae ${fisicas.map((m) => m.texto).join(' y ')}, no unidades: falta cargar la conversión`);
    }
    // inventario en masa o volumen
    const compat = fisicas.filter((m) => m.familia === inv.familia);
    if (!compat.length) return no(fisicas.length ? `la presentación viene en ${fisicas.map((m) => m.canon).join('/')} y el inventario en ${inv.etiqueta}: falta cargar la conversión (densidad)` : `la presentación trae solo unidades: falta cargar cuánto pesa`);
    if (compat.length > 1) return no('la presentación trae varias medidas');
    const m = compat[0];
    if (conteo.length > 1) return no('la presentación trae varias cantidades de unidades');
    const veces = conteo.length === 1 && it.envase && it.envase !== 'UND' ? conteo[0].cantidad : 1;         // "CAJAX6UNDX225G": 6 x 225 g
    const r = convertir(m.cantidad * veces, m.canon, inv.canon, indice);
    return r.ok ? si(r.valor, 'presentacion', veces > 1 ? `${txt} trae ${veces} × ${m.texto}` : `${txt} trae ${m.texto}`) : no(r.motivo);
  }

  // ---------- COMO SE VE ----------
  // Lo que se le muestra a la gente: hasta 2 decimales, coma decimal; lo minimo que no sea cero nunca se ve como "0".
  function fmt(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    const v = Number(n), a = Math.abs(v), dec = a >= 100 ? 0 : a >= 10 ? 1 : 2;
    const r = Number(v.toFixed(dec));
    if (r === 0 && v !== 0) return v > 0 ? '<0,01' : '>-0,01';
    return r.toLocaleString('es-CO', { maximumFractionDigits: dec });
  }
  // Nombre corto de la unidad de compra para acompanar la cifra: el envase (SIXPACK, BOLSA, CAJA, UND) o el texto tal cual (KILO).
  function etiquetaCompra(presentacion, indice) {
    indice = indice || indiceBase();
    const txt = String(presentacion == null ? '' : presentacion).trim();
    const it = interpretar(txt, indice);
    return it.envase || txt;
  }

  // Minimo y maximo de una fila de maximos_minimos, pasados a la unidad de compra.
  //  ok:false -> no hay regla clara: se dejan los numeros de inventario (min/max), con su unidad (unidadInv) y el motivo.
  function minMaxEnCompra(fila, presentacion, ctx) {
    ctx = ctx || crearContexto();
    const mi = fila && fila.minimo != null && fila.minimo !== '' ? Number(fila.minimo) : null;
    const ma = fila && fila.maximo != null && fila.maximo !== '' ? Number(fila.maximo) : null;
    const inv = unidadInventario(fila && fila.subarticulo, ctx.indice);
    const base = { minInv: mi, maxInv: ma, unidadInv: inv ? inv.etiqueta : null };
    const r = resolverFactor(presentacion, fila && fila.subarticulo, ctx);
    if (!r.ok) return Object.assign(base, { ok: false, motivo: r.motivo });
    const aCompra = (v) => (v == null || isNaN(v) ? null : v / r.factor);
    const unidad = etiquetaCompra(presentacion, ctx.indice);
    const min = aCompra(mi), max = aCompra(ma);
    return Object.assign(base, { ok: true, min, max, unidad, factor: r.factor, via: r.via, detalle: r.detalle,
      minTxt: min == null ? '—' : fmt(min), maxTxt: max == null ? '—' : fmt(max),
      tooltip: `En inventario: mín ${mi == null ? '—' : fmt(mi)} / máx ${ma == null ? '—' : fmt(ma)} ${base.unidadInv || ''} · ${r.detalle}` });
  }

  // ---------- QUE FILA DE maximos_minimos LE TOCA AL ARTICULO ----------
  // El articulo y el almacen se guardan por NOMBRE. Para casar, sin tildes, mayusculas ni signos.
  const claveNombre = (s) => norm(s).replace(/\s*\([^)]*\)\s*$/, '').replace(/[^A-Z0-9]/g, '');
  function indexarMaxMin(filas) {
    const m = new Map();
    for (const f of (filas || [])) { const k = claveNombre(f.articulo); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(f); }
    return m;
  }
  // almacen: nombre del almacen de la sede (o null). Si no hay de esa sede se usa la primera fila (como hacia la pagina).
  function filaDe(indiceMM, nombreArticulo, almacen) {
    const filas = indiceMM.get(claveNombre(nombreArticulo));
    if (!filas || !filas.length) return null;
    const a = claveNombre(almacen);
    return (a && filas.find((f) => claveNombre(f.almacen) === a)) || filas[0];
  }

  // ---------- LO QUE FALTA POR CARGAR ----------
  // Pares (unidad de compra, unidad de inventario) de articulos con maximo/minimo que no se pueden convertir solos: es lo que hay que subir en "conversiones".
  function conversionesFaltantes(articulos, filasMM, ctx) {
    ctx = ctx || crearContexto();
    const idx = indexarMaxMin(filasMM), grupos = new Map();
    for (const a of (articulos || [])) {
      const nombre = a.articulo_hiopos || a.articulo_comercial, filas = idx.get(claveNombre(nombre));
      if (!filas || !a.unimedida_compra) continue;
      for (const sub of new Set(filas.map((f) => norm(f.subarticulo)).filter(Boolean))) {
        const r = resolverFactor(a.unimedida_compra, sub, ctx);
        if (r.ok) continue;
        const k = claveFormato(a.unimedida_compra) + '|' + sub;
        const g = grupos.get(k) || { presentacion: String(a.unimedida_compra).trim(), unidadInventario: sub, articulos: 0, ejemplos: [], motivo: r.motivo };
        g.articulos++; if (g.ejemplos.length < 3) g.ejemplos.push(nombre);
        grupos.set(k, g);
      }
    }
    return [...grupos.values()].sort((a, b) => b.articulos - a.articulos || a.presentacion.localeCompare(b.presentacion));
  }

  return { CATALOGO_BASE, ALIAS_BASE, MAX_PLAUSIBLE, norm, construirIndice, indiceBase, parseNumero, expandir, interpretar, convertir, unidadInventario,
    claveFormato, indexarTabla, crearContexto, resolverFactor, fmt, etiquetaCompra, minMaxEnCompra, claveNombre, indexarMaxMin, filaDe, conversionesFaltantes };
});
