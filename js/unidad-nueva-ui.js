// ============================================================
//  unidad-nueva-ui.js  -  "CREAR UNIDAD NUEVA" desde la decision del agente  (21/09/2026)   (Admin -> Agente -> Unidades por decidir)
//  La lista de unidades sale de la base (unidad_catalogo); el administrador puede crear una nueva sin salir de la pantalla
//  (funcion unidad_crear). Validacion previa y opciones: js/unidad-nueva.js.
//  Usa las globales de index.html: $, SB, ag, perfil, pintarAdmin, escAg.
// ============================================================
const nu = { selId: null, canonTocado: false };

// Unidades y nombres alternos de la base (para la lista y para avisar antes de crear una repetida). Si falla, quedan las de siempre.
async function cargarUnidadesAg() {
  try {
    const [c, a] = await Promise.all([
      SB.from('unidad_catalogo').select('canon,nombre,familia,base,factor_base,um_erp,activo').eq('activo', true).order('nombre'),
      SB.from('unidad_alias').select('alias,canon').eq('activo', true)]);
    if (c.error || a.error) throw new Error((c.error || a.error).message);
    ag.unidades = c.data || []; ag.aliasMapa = {}; (a.data || []).forEach((x) => { ag.aliasMapa[x.alias] = x.canon; });
  } catch (e) { ag.unidades = ag.unidades || []; ag.aliasMapa = ag.aliasMapa || {}; }
}

// Al elegir "Crear unidad nueva…" en cualquier lista de unidades se abre el formulario (y la lista vuelve a "— unidad —")
function agUnidadCambio(sel) {
  if (sel.value !== UnidadNueva.CREAR) return;
  nu.selId = sel.id; sel.value = ''; agUnidadAbrir();
}
function agUnidadAbrir() {
  if (!perfil || perfil.rol !== 'admin') { alert('Solo el administrador puede crear unidades.'); return; }
  nu.canonTocado = false;
  ['nu_nombre', 'nu_canon', 'nu_factor', 'nu_alias'].forEach((id) => { $(id).value = ''; });
  $('nu_familia').value = 'empaque'; $('nu_um').value = 'UND'; $('nu_msg').textContent = ''; nuFamiliaCambio();
  $('modalUnidad').classList.add('on'); setTimeout(() => { try { $('nu_nombre').focus(); } catch (e) { /* sin foco */ } }, 100);
}
function agUnidadCerrar() { $('modalUnidad').classList.remove('on'); }
function nuNombreCambio() {
  if (!nu.canonTocado) $('nu_canon').value = UnidadNueva.sugerirCanon($('nu_nombre').value);
  nuFamiliaCambio();
}
// Cuando el codigo lo escribe la persona, deja de sugerirse solo
function nuCanonEscrito() { nu.canonTocado = true; }
// Los campos de equivalencia solo aplican a peso, volumen y conteo; se dice en que se mide (gramos, mililitros, unidades)
function nuFamiliaCambio() {
  const fam = UnidadNueva.FAMILIAS[$('nu_familia').value] || UnidadNueva.FAMILIAS.empaque;
  $('nu_fila_factor').style.display = fam.base ? 'block' : 'none';
  $('nu_factor_txt').textContent = fam.base ? `1 ${$('nu_nombre').value.trim() || 'de esta unidad'} equivale a … ${fam.baseTxt}` : '';
}

async function agUnidadCrear() {
  const msg = (t, ok) => { const e = $('nu_msg'); e.textContent = t; e.style.color = ok ? '#166534' : '#991b1b'; };
  const f = { nombre: $('nu_nombre').value, canon: $('nu_canon').value, familia: $('nu_familia').value, factor: $('nu_factor').value, um_erp: $('nu_um').value, alias: $('nu_alias').value };
  const v = UnidadNueva.validar(f, { canones: (ag.unidades || []).map((u) => u.canon), alias: ag.aliasMapa || {} });
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
