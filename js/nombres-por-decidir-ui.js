// ============================================================
//  nombres-por-decidir-ui.js  -  "NOMBRES POR DECIDIR" en Admin -> Agente  (22/09/2026)
//  Cada fila es un texto de factura que el agente no pudo emparejar con el pedido. Se elige (o se escribe) a que nombre EXACTO del pedido/ERP
//  corresponde: queda aprendido para ese proveedor (tambien resuelve la presentacion, ej. "2 KILOS" vs "UNDX2270", porque el nombre ya lo dice) y
//  el agente ya no vuelve a preguntar por ese texto. "No es lo mismo" solo saca la fila de la lista, sin ensenar nada.
//  Logica de decision: js/nombres-por-decidir.js. Usa las globales de index.html: $, SB, ag, perfil, usuario, pintarAdmin, escAg, fhAg.
// ============================================================

// Se carga junto con lo demas del Agente (ver cargarAgente en index.html). Si falla, la lista queda vacia (no rompe el resto de la pantalla).
async function cargarNombresDecidir() {
  try {
    const { data, error } = await SB.from('producto_revision').select('*').eq('estado', 'pendiente').order('creado_en', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    ag.productos = data || [];
  } catch (e) { ag.productos = ag.productos || []; }
}

function agProductoElegir(i, nombre) { const e = $('agpn_' + i); if (e) e.value = nombre; }

async function agProductoEnsenar(i) {
  const r = (ag.productos || [])[i]; if (!r) return;
  const msg = (t) => { const e = $('agpm_' + i); if (e) e.textContent = t; };
  const v = NombresPorDecidir.validarNombre($('agpn_' + i).value);
  if (!v.ok) { msg(v.error); return; }
  const params = NombresPorDecidir.armarEnsenar(r, v.nombre, (perfil && perfil.nombre) || (usuario && usuario.email) || 'admin');
  const btn = $('agpb_' + i); if (btn) btn.disabled = true;
  const { error } = await SB.rpc('producto_alias_registrar', params);
  if (btn) btn.disabled = false;
  if (error) { msg('No se pudo guardar: ' + error.message); return; }
  await cargarNombresDecidir(); pintarAdmin();
}

async function agProductoDescartar(i) {
  const r = (ag.productos || [])[i]; if (!r) return;
  if (!confirm(`¿"${r.texto_factura}" no corresponde a ningún nombre del pedido (es un insumo distinto)? Solo se saca de esta lista; no se enseña nada.`)) return;
  const { error } = await SB.rpc('producto_revision_descartar', { p_id: r.id, p_usuario: (perfil && perfil.nombre) || (usuario && usuario.email) || 'admin' });
  if (error) { alert('No se pudo descartar: ' + error.message); return; }
  await cargarNombresDecidir(); pintarAdmin();
}
