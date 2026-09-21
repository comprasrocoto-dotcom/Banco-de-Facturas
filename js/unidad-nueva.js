// ============================================================
//  unidad-nueva.js  -  UNIDADES DE MEDIDA EN LA DECISION DEL AGENTE  (21/09/2026)
//   1) opcionesHtml(): la lista de unidades del <select> "unidad" sale de la BASE (unidad_catalogo), no de una lista fija de 3;
//      primero las de siempre (Kilo, Unidad, Libra), luego el resto agrupado por tipo, y al final "Crear unidad nueva…".
//   2) validar(): revisa el formulario de una unidad nueva con las mismas reglas que la funcion unidad_crear de la base
//      (supabase/unidad_crear.sql y unidad_crear_erp.sql), para avisar antes de enviarla. La base es la que decide de verdad.
//   3) Unidades del ERP: unidadesErp() saca de los articulos las unidades de COMPRA tal como las escribe el ERP (PAQUETEX25UND, KILO...);
//      deducir() lee de ese nombre el tipo y la equivalencia (PAQUETEX25UND = 25 unidades); inventarioOpciones() da las unidades de inventario.
//  Logica PURA y determinista (sin red, sin IA). La usa index.html (js/unidad-nueva-ui.js) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./conversiones.js'));
  else root.UnidadNueva = factory(root.Conversiones);
})(typeof self !== 'undefined' ? self : this, function (Conv) {
  'use strict';

  const CREAR = '__nueva__';
  // Las tres que el robot distingue de siempre, con los nombres de siempre
  const DE_SIEMPRE = [['KG', 'Kilo (KG)'], ['UND', 'Unidad / presentación (UND)'], ['LB', 'Libra (LB)']];
  const FAMILIAS = {
    masa: { titulo: 'Peso', base: 'g', baseTxt: 'gramos' },
    volumen: { titulo: 'Volumen', base: 'ml', baseTxt: 'mililitros' },
    conteo: { titulo: 'Conteo (unidades)', base: 'und', baseTxt: 'unidades' },
    empaque: { titulo: 'Empaque (caja, bolsa, tula…)', base: null, baseTxt: null },
  };
  const ORDEN_FAMILIA = ['masa', 'volumen', 'conteo', 'empaque'];
  const UM_ERP = [['UND', 'Unidad / presentación (UND)'], ['KG', 'Kilo (KG)'], ['LB', 'Libra (LB)']];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sinTildes = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u{300}-\u{36f}]/gu, '');
  const norm = (s) => sinTildes(s).toUpperCase().replace(/\s+/g, ' ').trim();
  // Llave para comparar nombres de unidades del ERP: sin espacios y con "*" = "X" ("CAJA*12UND" = "CAJA X 12UND")
  const formato = (t) => norm(t).replace(/\s+/g, '').replace(/[*×]/g, 'X');

  // "Galón de 5 L" -> "GALONDE5L" (hasta 20 letras y numeros): una sugerencia para el codigo
  const sugerirCanon = (nombre) => norm(nombre).replace(/[^A-Z0-9]/g, '').slice(0, 20);

  // unidades: filas de unidad_catalogo { canon, nombre, familia }. Devuelve el HTML de las <option>.
  function opcionesHtml(unidades, sel, opc) {
    opc = opc || {};
    const lista = (unidades || []).filter((u) => u && u.canon && u.activo !== false);
    const nombreDe = new Map(lista.map((u) => [u.canon, u.nombre]));
    const op = (v, t) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`;
    let h = '<option value="">— unidad —</option>' + DE_SIEMPRE.map(([v, t]) => op(v, t)).join('');
    const siempre = new Set(DE_SIEMPRE.map((x) => x[0]));
    for (const fam of ORDEN_FAMILIA) {
      const grupo = lista.filter((u) => u.familia === fam && !siempre.has(u.canon)).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
      if (grupo.length) h += `<optgroup label="${esc(FAMILIAS[fam].titulo)}">` + grupo.map((u) => op(u.canon, `${u.nombre} (${u.canon})`)).join('') + '</optgroup>';
    }
    // una unidad elegida antes que ya no esta en la lista (o la base no respondio): no se pierde
    if (sel && !siempre.has(sel) && !nombreDe.has(sel)) h += op(sel, sel);
    if (opc.crear) h += `<option value="${CREAR}">➕ Crear unidad nueva…</option>`;
    return h;
  }

  // ---------------------------------------------------------------- UNIDADES DEL ERP
  // articulos: filas con unimedida_compra. -> [{ texto, n }]  las unidades de compra distintas (una sola escritura por nombre), A-Z, con cuantos articulos la usan
  function unidadesErp(articulos) {
    const grupos = new Map();
    for (const a of (articulos || [])) {
      const t = String(a && a.unimedida_compra != null ? a.unimedida_compra : '').replace(/\s+/g, ' ').trim(), k = formato(t);
      if (!t || !k) continue;
      const g = grupos.get(k) || { n: 0, escrituras: new Map() };
      g.n++; g.escrituras.set(t, (g.escrituras.get(t) || 0) + 1); grupos.set(k, g);
    }
    return [...grupos.values()].map((g) => ({ texto: [...g.escrituras.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], n: g.n }))
      .sort((a, b) => a.texto.localeCompare(b.texto, 'es'));
  }
  // De la unidad del ERP se lee el tipo y la equivalencia cuando dice UNA sola cosa medible: PAQUETEX25UND -> 25 unidades; BOLSAX500G -> 500 gramos;
  // TARROX60ML -> 60 ml. Con varias medidas (CAJAX6UNDX225G) o ninguna (SIXPACK, KILO) no se adivina. -> { familia, cantidad, inv } | null
  function deducir(texto) {
    if (!Conv || !texto) return null;
    const it = Conv.interpretar(String(texto)), fis = it.medidas.filter((m) => m.plausible);
    if (it.medidas.length !== 1 || fis.length !== 1) return null;
    const m = fis[0]; if (!FAMILIAS[m.familia] || m.familia === 'empaque') return null;
    return { familia: m.familia, cantidad: m.cantidad, inv: m.canon };
  }
  // Unidades de inventario que se pueden elegir para un tipo: las medibles del catalogo (sin las de compra del ERP), la mas pequeña primero
  function inventarioOpciones(unidades, familia) {
    return (unidades || []).filter((u) => u && u.activo !== false && u.familia === familia && u.familia !== 'empaque' && !u.erp_compra && Number(u.factor_base) > 0)
      .map((u) => ({ canon: u.canon, nombre: u.nombre, factor: Number(u.factor_base) })).sort((a, b) => a.factor - b.factor || a.nombre.localeCompare(b.nombre, 'es'));
  }
  // { FORMATO: CANON } de las unidades que ya tienen nombre del ERP, y la busqueda por nombre
  const mapaErp = (unidades) => { const m = {}; for (const u of (unidades || [])) if (u && u.erp_compra) m[formato(u.erp_compra)] = u.canon; return m; };
  function unidadDelErp(texto, unidades) { const c = mapaErp(unidades)[formato(texto)]; return c ? (unidades || []).find((u) => u.canon === c) || null : null; }

  // "12500" "12.500" (miles) "3,785" "1.234,5" "0.75" -> numero ; NaN si no lo es (mismo criterio que el importador de bases)
  function numero(t) {
    const s = String(t == null ? '' : t).trim().replace(/\s+/g, '');
    if (!/^[0-9.,]+$/.test(s)) return NaN;
    const p = (s.match(/\./g) || []).length, c = (s.match(/,/g) || []).length;
    if (p && c) { const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',', mil = dec === '.' ? ',' : '.'; return Number(s.split(mil).join('').replace(dec, '.')); }
    if (c > 1 || p > 1) return Number(s.replace(/[.,]/g, ''));
    if (c === 1) return Number(s.replace(',', '.'));
    if (p === 1 && /^[1-9][0-9]{0,2}\.[0-9]{3}$/.test(s)) return Number(s.replace('.', ''));
    return Number(s);
  }

  // f: { nombre, canon, familia, factor, invFactor, invNombre, erp_compra, um_erp, alias (texto separado por comas) }
  //   factor = cuanto equivale 1 de esta unidad, en la unidad de INVENTARIO elegida; invFactor = cuantos g / ml / unidades base tiene 1 de esa unidad (por defecto 1)
  // existentes: { canones: [..], alias: { ALIAS: CANON }, erp: { FORMATO: CANON } }     -> { ok, errores[], datos }   datos = parametros de unidad_crear
  function validar(f, existentes) {
    f = f || {}; existentes = existentes || {};
    const err = [], canones = new Set((existentes.canones || []).map(norm)), aliasDe = existentes.alias || {}, erpDe = existentes.erp || {};
    const canon = norm(f.canon).replace(/\s+/g, '');
    if (!/^[A-Z0-9]{1,20}$/.test(canon)) err.push('El código debe tener de 1 a 20 letras o números, sin espacios ni signos (ej. GALON, ARROBA).');
    else if (canones.has(canon)) err.push(`Ya existe una unidad con el código ${canon}.`);
    const nombre = String(f.nombre == null ? '' : f.nombre).replace(/\s+/g, ' ').trim();
    if (nombre.length < 2 || nombre.length > 40) err.push('El nombre debe tener entre 2 y 40 caracteres.');
    const fam = FAMILIAS[f.familia] ? f.familia : null;
    if (!fam) err.push('Elige el tipo de unidad.');
    let factor = null;
    if (fam && fam !== 'empaque') {
      const n = numero(f.factor), inv = Number(f.invFactor) > 0 ? Number(f.invFactor) : 1, total = Math.round(n * inv * 1e6) / 1e6;
      if (!(n > 0) || !(total > 0) || total > 100000000) err.push(`Di cuánto equivale 1 ${nombre || 'de esta unidad'} en ${f.invNombre || FAMILIAS[fam].baseTxt}: un número mayor que 0.`); else factor = total;
    }
    const um = String(f.um_erp || 'UND').toUpperCase();
    if (!UM_ERP.some((x) => x[0] === um)) err.push('Elige cómo la maneja el ERP.');
    // nombre de la unidad de compra en el ERP (opcional): el robot busca la fila que lo trae
    const erp = String(f.erp_compra == null ? '' : f.erp_compra).replace(/\s+/g, ' ').trim();
    if (erp.length > 60) err.push('El nombre de la unidad del ERP es muy largo (máximo 60 caracteres).');
    else if (erp && erpDe[formato(erp)]) err.push(`La unidad del ERP "${erp}" ya está asociada a la unidad ${erpDe[formato(erp)]}.`);
    // nombres alternos: separados por coma, punto y coma o linea; cada uno, solo letras y numeros
    const crudos = String(f.alias == null ? '' : f.alias).split(/[,;\n]+/).map(norm).filter(Boolean), alias = [];
    for (const a of crudos) {
      if (!/^[A-Z0-9]{1,20}$/.test(a)) { err.push(`El nombre alterno "${a}" no es válido: solo letras y números, sin espacios (sepáralos con comas).`); continue; }
      if (!alias.includes(a)) alias.push(a);
    }
    const propios = [canones.has(canon) ? '' : canon, norm(nombre)].filter((x) => /^[A-Z0-9]{1,20}$/.test(x));   // si el codigo ya existe, ya se aviso: no se repite
    for (const a of new Set([...propios, ...alias])) if (aliasDe[a]) err.push(`"${a}" ya se usa para otra unidad (${aliasDe[a]}).`);
    return { ok: !err.length, errores: err, datos: err.length ? null : { p_canon: canon, p_nombre: nombre, p_familia: fam, p_factor: factor, p_um_erp: um, p_alias: alias, p_erp_compra: erp || null } };
  }

  return { CREAR, DE_SIEMPRE, FAMILIAS, ORDEN_FAMILIA, UM_ERP, formato, sugerirCanon, opcionesHtml, unidadesErp, deducir, inventarioOpciones, mapaErp, unidadDelErp, validar };
});
