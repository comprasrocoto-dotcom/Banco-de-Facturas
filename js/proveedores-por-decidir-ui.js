// ============================================================
//  proveedores-por-decidir-ui.js  -  "PROVEEDORES POR DECIDIR" en Admin -> Agente  (28/09/2026)
//  Cada fila es un proveedor que el bot de pedidos NO encontro en el ERP al montar un pedido. Se elige (o se escribe) el nombre EXACTO que usa el
//  ERP: queda aprendido por NIT y el agente ya no vuelve a preguntar por ese proveedor. "No existe en el ERP" solo saca la fila de la lista.
//  Logica de decision: js/proveedores-por-decidir.js. Usa las globales de index.html: $, SB, ag, perfil, usuario, pintarAdmin, escAg, fhAg.
// ============================================================

// Se carga junto con lo demas del Agente (ver cargarAgente en index.html). Si falla, la lista queda vacia (no rompe el resto de la pantalla).
async function cargarProveedoresPorDecidir() {
  try {
    const { data, error } = await SB.from('proveedor_revision').select('*').eq('estado', 'pendiente').order('creado_en', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    ag.proveedoresRev = data || [];
  } catch (e) { ag.proveedoresRev = ag.proveedoresRev || []; }
}

function agProveedorElegir(i, nombre) { const e = $('agvn_' + i); if (e) e.value = nombre; }

async function agProveedorEnsenar(i) {
  const r = (ag.proveedoresRev || [])[i]; if (!r) return;
  const msg = (t) => { const e = $('agvm_' + i); if (e) e.textContent = t; };
  const vn = ProveedoresPorDecidir.validarNit($('agvi_' + i).value);
  if (!vn.ok) { msg(vn.error); return; }
  const vb = ProveedoresPorDecidir.validarNombre($('agvn_' + i).value);
  if (!vb.ok) { msg(vb.error); return; }
  const params = ProveedoresPorDecidir.armarEnsenar(r, vn.nit, vb.nombre, (perfil && perfil.nombre) || (usuario && usuario.email) || 'admin');
  const btn = $('agvb_' + i); if (btn) btn.disabled = true;
  const { error } = await SB.rpc('proveedor_nombre_pos_registrar', params);
  if (btn) btn.disabled = false;
  if (error) { msg('No se pudo guardar: ' + error.message); return; }
  await cargarProveedoresPorDecidir(); pintarAdmin();
}

async function agProveedorDescartar(i) {
  const r = (ag.proveedoresRev || [])[i]; if (!r) return;
  if (!confirm(`¿"${r.proveedor_texto}" todavía no existe en el ERP (hay que crearlo allá)? Solo se saca de esta lista; no se enseña nada.`)) return;
  const { error } = await SB.rpc('proveedor_revision_descartar', { p_id: r.id, p_usuario: (perfil && perfil.nombre) || (usuario && usuario.email) || 'admin' });
  if (error) { alert('No se pudo descartar: ' + error.message); return; }
  await cargarProveedoresPorDecidir(); pintarAdmin();
}
