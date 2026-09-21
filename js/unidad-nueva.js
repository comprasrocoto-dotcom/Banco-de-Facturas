// ============================================================
//  unidad-nueva.js  -  UNIDADES DE MEDIDA EN LA DECISION DEL AGENTE  (21/09/2026)
//   1) opcionesHtml(): la lista de unidades del <select> "unidad" sale de la BASE (unidad_catalogo), no de una lista fija de 3;
//      primero las de siempre (Kilo, Unidad, Libra), luego el resto agrupado por tipo, y al final "Crear unidad nueva…".
//   2) validar(): revisa el formulario de una unidad nueva con las mismas reglas que la funcion unidad_crear de la base
//      (supabase/unidad_crear.sql), para avisar antes de enviarla. La base es la que decide de verdad.
//  Logica PURA y determinista (sin red, sin IA). La usa index.html (js/unidad-nueva-ui.js) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UnidadNueva = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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

  // "Galón de 5 L" -> "GALONDE5L" (hasta 12 letras y numeros): una sugerencia para el codigo
  const sugerirCanon = (nombre) => norm(nombre).replace(/[^A-Z0-9]/g, '').slice(0, 12);

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

  // f: { nombre, canon, familia, factor, um_erp, alias (texto separado por comas) }
  // existentes: { canones: [..], alias: { ALIAS: CANON } }     -> { ok, errores[], datos }   datos = parametros de unidad_crear
  function validar(f, existentes) {
    f = f || {}; existentes = existentes || {};
    const err = [], canones = new Set((existentes.canones || []).map(norm)), aliasDe = existentes.alias || {};
    const canon = norm(f.canon).replace(/\s+/g, '');
    if (!/^[A-Z0-9]{1,12}$/.test(canon)) err.push('El código debe tener de 1 a 12 letras o números, sin espacios ni signos (ej. GALON, ARROBA).');
    else if (canones.has(canon)) err.push(`Ya existe una unidad con el código ${canon}.`);
    const nombre = String(f.nombre == null ? '' : f.nombre).replace(/\s+/g, ' ').trim();
    if (nombre.length < 2 || nombre.length > 40) err.push('El nombre debe tener entre 2 y 40 caracteres.');
    const fam = FAMILIAS[f.familia] ? f.familia : null;
    if (!fam) err.push('Elige el tipo de unidad.');
    let factor = null;
    if (fam && fam !== 'empaque') {
      const n = numero(f.factor);
      if (!(n > 0) || n > 100000000) err.push(`Di cuánto equivale 1 ${nombre || 'de esta unidad'} en ${FAMILIAS[fam].baseTxt}: un número mayor que 0.`); else factor = n;
    }
    const um = String(f.um_erp || 'UND').toUpperCase();
    if (!UM_ERP.some((x) => x[0] === um)) err.push('Elige cómo la maneja el ERP.');
    // nombres alternos: separados por coma, punto y coma o linea; cada uno, solo letras y numeros
    const crudos = String(f.alias == null ? '' : f.alias).split(/[,;\n]+/).map(norm).filter(Boolean), alias = [];
    for (const a of crudos) {
      if (!/^[A-Z0-9]{1,20}$/.test(a)) { err.push(`El nombre alterno "${a}" no es válido: solo letras y números, sin espacios (sepáralos con comas).`); continue; }
      if (!alias.includes(a)) alias.push(a);
    }
    const propios = [canones.has(canon) ? '' : canon, norm(nombre)].filter((x) => /^[A-Z0-9]{1,20}$/.test(x));   // si el codigo ya existe, ya se aviso: no se repite
    for (const a of new Set([...propios, ...alias])) if (aliasDe[a]) err.push(`"${a}" ya se usa para otra unidad (${aliasDe[a]}).`);
    return { ok: !err.length, errores: err, datos: err.length ? null : { p_canon: canon, p_nombre: nombre, p_familia: fam, p_factor: factor, p_um_erp: um, p_alias: alias } };
  }

  return { CREAR, DE_SIEMPRE, FAMILIAS, ORDEN_FAMILIA, UM_ERP, sugerirCanon, opcionesHtml, validar };
});
