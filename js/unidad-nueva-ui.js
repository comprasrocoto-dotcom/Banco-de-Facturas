// ============================================================
//  unidad-nueva-ui.js  -  "CREAR UNIDAD NUEVA" desde la decision del agente  (21/09/2026)   (Admin -> Agente -> Unidades por decidir)
//  La lista de unidades sale de la base (unidad_catalogo); el administrador puede crear una nueva sin salir de la pantalla
//  (funcion unidad_crear). Las unidades de COMPRA del ERP (articulos.unimedida_compra, ej. PAQUETEX25UND) se traen de la base para elegirlas,
//  y la unidad de INVENTARIO sale de las del catalogo. Validacion previa y opciones: js/unidad-nueva.js.
//  Usa las globales de index.html: $, SB, ag, perfil, pintarAdmin, escAg, traerTodo.
// ============================================================
const nu = { selId: null, canonTocado: false, nombreTocado: false, factorTocado: false };

// Unidades, nombres alternos y unidades de compra del ERP (para las listas y para avisar antes de crear una repetida). Si falla, quedan las de siempre.
async function cargarUnidadesAg() {
  try {
    const [c, a, art] = await Promise.all([
      SB.from('unidad_catalogo').select('canon,nombre,familia,base,factor_base,um_erp,erp_compra,activo').eq('activo', true).order('nombre'),
      SB.from('unidad_alias').select('alias,canon').eq('activo', true),
      traerTodo('articulos', 'id,unimedida_compra', ['id'])]);
    if (c.error || a.error) throw new Error((c.error || a.error).message);
    ag.unidades = c.data || []; ag.aliasMapa = {}; (a.data || []).forEach((x) => { ag.aliasMapa[x.alias] = x.canon; });
    ag.unidadesErp = UnidadNueva.unidadesErp(art || []);
  } catch (e) { ag.unidades = ag.unidades || []; ag.aliasMapa = ag.aliasMapa || {}; ag.unidadesErp = ag.unidadesErp || []; }
}

// Al elegir "Crear unidad nueva…" en cualquier lista de unidades se abre el formulario (y la lista vuelve a "— unidad —")
function agUnidadCambio(sel) {
  if (sel.value !== UnidadNueva.CREAR) return;
  nu.selId = sel.id; sel.value = ''; agUnidadAbrir();
}
function agUnidadAbrir() {
  if (!perfil || perfil.rol !== 'admin') { alert('Solo el administrador puede crear unidades.'); return; }
  nu.canonTocado = false; nu.nombreTocado = false; nu.factorTocado = false;
  ['nu_erp', 'nu_nombre', 'nu_canon', 'nu_factor', 'nu_alias'].forEach((id) => { $(id).value = ''; });
  // las unidades del ERP que ya tienen su unidad no se vuelven a ofrecer
  const tomadas = UnidadNueva.mapaErp(ag.unidades);
  $('nu_erp_lista').innerHTML = (ag.unidadesErp || []).filter((u) => !tomadas[UnidadNueva.formato(u.texto)])
    .map((u) => `<option value="${escAg(u.texto)}">${u.n} artículo${u.n === 1 ? '' : 's'}</option>`).join('');
  $('nu_familia').value = 'empaque'; $('nu_um').value = 'UND'; $('nu_msg').textContent = ''; $('nu_erp_aviso').textContent = ''; nuFamiliaCambio();
  $('modalUnidad').classList.add('on'); setTimeout(() => { try { $('nu_erp').focus(); } catch (e) { /* sin foco */ } }, 100);
}
function agUnidadCerrar() { $('modalUnidad').classList.remove('on'); }

// Elegir o escribir la unidad de compra del ERP: llena solos el nombre, el codigo, el tipo y la equivalencia (lo que la persona ya escribio no se pisa)
function nuErpCambio() {
  const txt = $('nu_erp').value.replace(/\s+/g, ' ').trim(), aviso = $('nu_erp_aviso');
  aviso.textContent = ''; aviso.style.color = '#92400e';
  if (!txt) return;
  const ya = UnidadNueva.unidadDelErp(txt, ag.unidades);
  if (ya) { aviso.textContent = `Esa unidad del ERP ya está asociada a "${ya.nombre}" (${ya.canon}). Elígela en la lista de unidades.`; return; }
  if (!nu.nombreTocado) { $('nu_nombre').value = txt; if (!nu.canonTocado) $('nu_canon').value = UnidadNueva.sugerirCanon(txt); }
  const d = UnidadNueva.deducir(txt);
  if (d && !nu.factorTocado) {
    $('nu_familia').value = d.familia; nuFamiliaCambio(d.inv); $('nu_factor').value = String(d.cantidad);
    aviso.style.color = '#166534'; aviso.textContent = `Leí del nombre: 1 ${txt} = ${d.cantidad} ${d.inv} de inventario. Revísalo.`;
  } else nuFamiliaCambio();
}
function nuNombreCambio() {
  nu.nombreTocado = true;
  if (!nu.canonTocado) $('nu_canon').value = UnidadNueva.sugerirCanon($('nu_nombre').value);
  nuFamiliaCambio();
}
// Cuando el codigo lo escribe la persona, deja de sugerirse solo
function nuCanonEscrito() { nu.canonTocado = true; }
function nuFactorEscrito() { nu.factorTocado = true; }
// Los campos de equivalencia solo aplican a peso, volumen y conteo; la unidad de inventario se elige entre las del catalogo de ese tipo
function nuFamiliaCambio(inv) {
  const fam = UnidadNueva.FAMILIAS[$('nu_familia').value] || UnidadNueva.FAMILIAS.empaque, s = $('nu_inv');
  $('nu_fila_factor').style.display = fam.base ? 'block' : 'none';
  $('nu_factor_txt').textContent = fam.base ? `1 ${$('nu_nombre').value.trim() || 'de esta unidad'} equivale a … (unidad de inventario)` : '';
  if (!fam.base) { s.innerHTML = ''; return; }
  const previa = inv || s.value, ops = UnidadNueva.inventarioOpciones(ag.unidades, $('nu_familia').value);
  s.innerHTML = ops.map((o) => `<option value="${escAg(o.canon)}" data-f="${o.factor}" data-n="${escAg(o.nombre)}">${escAg(o.nombre)} (${escAg(o.canon)})</option>`).join('');
  if (previa && ops.some((o) => o.canon === previa)) s.value = previa;
  else { const b = ops.find((o) => o.factor === 1); if (b) s.value = b.canon; }              // por defecto la unidad base (g, ml, und)
}

async function agUnidadCrear() {
  const msg = (t, ok) => { const e = $('nu_msg'); e.textContent = t; e.style.color = ok ? '#166534' : '#991b1b'; };
  const op = $('nu_inv').selectedOptions && $('nu_inv').selectedOptions[0];
  const f = { nombre: $('nu_nombre').value, canon: $('nu_canon').value, familia: $('nu_familia').value, factor: $('nu_factor').value, um_erp: $('nu_um').value, alias: $('nu_alias').value,
    erp_compra: $('nu_erp').value, invFactor: op ? Number(op.dataset.f) : 1, invNombre: op ? op.dataset.n : '' };
  const v = UnidadNueva.validar(f, { canones: (ag.unidades || []).map((u) => u.canon), alias: ag.aliasMapa || {}, erp: UnidadNueva.mapaErp(ag.unidades) });
  if (!v.ok) { msg(v.errores.join(' ')); return; }
  const btn = $('nu_crear'); btn.disabled = true;
  const { data, error } = await SB.rpc('unidad_crear', v.datos);
  btn.disabled = false;
  if (error) { msg('No se pudo crear: ' + error.message); return; }
  await cargarUnidadesAg();
  agUnidadCerrar(); pintarAdmin();
  const s = nu.selId && $(nu.selId); if (s) s.value = data.canon;                    // la unidad recien creada queda elegida en esa fila
  nu.selId = null;
}
