// ============================================================
//  hoja-contable-ui.js  -  HOJA CONTABLE dentro del Organizador Hiopos  (10/10/2026)
//  Carga (paginado, sin el tope de 1.000 filas) el catalogo contable, las reglas por familia, las facturas con N° de ingreso,
//  los pedidos amarrados y sus articulos; opcionalmente el INFORME DE ARTICULOS de Hiopos ("FACTURAS DE COMPRA", unico lugar
//  con los articulos de 123 wok, Casa de Nadie y Sin Par). Arma la plantilla con HojaContable.armar (js/hoja-contable.js).
//  Las reglas por familia solo se aplican cuando una persona las CONFIRMA (tabla contable_regla_familia).
//  Usa globales de index.html ($, SB, perfil, usuario, escAg, money, XLSX) y del Organizador (orgH, orgHPintar, orgHUsuario).
// ============================================================
let orgC = { informe: null, informeNombre: '', informeError: '', datos: null, cargando: false, error: '' };

async function orgCTodo(tabla, campos, filtro) {
  const r = [];
  for (let d = 0; ; d += 1000) {
    let q = SB.from(tabla).select(campos);
    if (filtro) q = filtro(q);
    const { data, error } = await q.range(d, d + 999);
    if (error) throw new Error(tabla + ': ' + error.message);
    r.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  return r;
}
async function orgHCargarContable(forzar) {
  if (orgC.cargando || (orgC.datos && !forzar)) return;
  orgC.cargando = true; orgC.error = '';
  try {
    const [catalogo, reglas, facturas, pedidos, articulos] = await Promise.all([
      orgCTodo('cuentas_contables', 'id,clasificacion,articulo,familia,subfamilia,grupo_cuenta,referencia,cuenta_contable,cuenta_devolucion'),
      orgCTodo('contable_regla_familia', '*'),
      orgCTodo('facturas', 'cufe,num_ingreso,documento,prefijo,folio'),
      orgCTodo('pedidos', 'id,numero,factura_cufe,centro_costo', (q) => q.not('factura_cufe', 'is', null)),
      orgCTodo('articulos', 'codigo_barras,subfamilia'),
    ]);
    const lineas = [], ids = pedidos.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 150) lineas.push(...await orgCTodo('pedido_lineas', 'pedido_id,codigo,insumo,cantidad,unidad,subfamilia', (q) => q.in('pedido_id', ids.slice(i, i + 150))));
    orgC.datos = { catalogo, reglas, web: { facturas, pedidos, lineas, familiaPorCodigo: new Map(articulos.map((a) => [HojaContable.norm(a.codigo_barras), a.subfamilia])) } };
  } catch (e) { orgC.error = 'No pude cargar los datos contables: ' + e.message; }
  orgC.cargando = false;
  orgHPintar();
}
async function orgHInforme(input) {
  const f = input.files && input.files[0]; if (!f) return;
  orgC.informeError = ''; orgC.informe = null; orgC.informeNombre = f.name;
  try {
    const buf = await f.arrayBuffer();
    let mejor = null;
    if (/\.(csv|txt)$/i.test(f.name)) {
      let texto = new TextDecoder('utf-8').decode(buf);
      if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf);
      mejor = HojaContable.leerInformeArticulos(OrganizadorHiopos.leerCsv(texto));
    } else {
      const wb = XLSX.read(buf, { type: 'array' });
      for (const n of wb.SheetNames) {
        const l = HojaContable.leerInformeArticulos(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
        if (!l.error && (!mejor || mejor.error || l.lineas.length > mejor.lineas.length)) mejor = l; else if (!mejor) mejor = l;
      }
    }
    if (!mejor || mejor.error) throw new Error((mejor && mejor.error) || 'No encontré el informe de artículos en el archivo.');
    orgC.informe = mejor.lineas;
    orgH.ver = 'contable';
  } catch (e) { orgC.informeError = e.message; }
  input.value = '';
  orgHPintar();
}
// el cruce (lo llama orgHCalcular): null hasta que esten los datos
function orgHContableCalcular(cl) {
  if (!orgC.datos || typeof HojaContable === 'undefined') return null;
  return HojaContable.armar({ documentos: cl.documentos, informe: orgC.informe || [], web: orgC.datos.web, catalogo: orgC.datos.catalogo, reglas: orgC.datos.reglas, dian: orgH.dian || null });
}
// reglas por familia: confirmar una propuesta, crear una a mano eligiendo el grupo del catalogo, activar/desactivar
async function orgCGuardarRegla(fila) {
  const r = Object.assign({}, fila, { activo: fila.activo !== false, confirmado_por: orgHUsuario(), confirmado_en: new Date().toISOString() });
  delete r.n; delete r.base; delete r.sinPropuesta;
  const { error } = await SB.from('contable_regla_familia').upsert(r, { onConflict: 'familia_norm' });
  if (error) { alert('No se pudo guardar la regla: ' + error.message); return; }
  const l = orgC.datos.reglas.filter((x) => x.familia_norm !== r.familia_norm); l.push(r); orgC.datos.reglas = l;
  orgHPintar();
}
function orgCPropuestas(cont) { return HojaContable.proponerReglas(cont.sinHomologar, orgC.datos.catalogo, HojaContable.indexarReglas(orgC.datos.reglas)); }
async function orgCConfirmar(familiaNorm) {
  const x = orgHCalcular(); if (!x || !x.contable) return;
  const p = orgCPropuestas(x.contable).find((z) => z.familia_norm === familiaNorm && !z.sinPropuesta); if (!p) return;
  if (!confirm('Regla para TODA la familia ' + p.familia_hiopos + ' de Hiopos:\n\n' + p.grupo_cuenta + ' · cuenta ' + p.cuenta_contable + ' (devolución ' + p.cuenta_devolucion + ')' + (/SEDES/.test(p.grupo_cuenta) ? '\n(solo cuando el almacén es una sede)' : '') + '\n\nSe aplicará a los artículos de esa familia que no estén en el catálogo, en este y en los próximos archivos. ¿Confirmas?')) return;
  await orgCGuardarRegla(p);
}
function orgCGrupos() {   // grupos del catalogo con su cuenta (para crear una regla a mano)
  const m = new Map();
  for (const f of orgC.datos.catalogo) if (f.cuenta_contable && !String(f.grupo_cuenta || '').startsWith('=')) { const k = f.grupo_cuenta + '|' + f.cuenta_contable; if (!m.has(k)) m.set(k, f); }
  return [...m.values()].sort((a, b) => String(a.grupo_cuenta).localeCompare(String(b.grupo_cuenta)));
}
async function orgCManual(familiaNorm, familiaHiopos, sel) {
  const g = orgCGrupos()[Number(sel.value)]; if (!g) return;
  if (!confirm('Regla para TODA la familia ' + familiaHiopos + ' de Hiopos:\n\n' + g.grupo_cuenta + ' · cuenta ' + g.cuenta_contable + '\n\n¿Confirmas?')) { sel.value = ''; return; }
  await orgCGuardarRegla({ familia_norm: familiaNorm, familia_hiopos: familiaHiopos, familia: g.familia, subfamilia: g.subfamilia, grupo_cuenta: g.grupo_cuenta, referencia: g.referencia || g.cuenta_contable, cuenta_contable: g.cuenta_contable, cuenta_devolucion: g.cuenta_devolucion || g.cuenta_contable });
}
async function orgCActivar(familiaNorm, activo) {
  const r = orgC.datos.reglas.find((x) => x.familia_norm === familiaNorm); if (!r) return;
  await orgCGuardarRegla(Object.assign({}, r, { activo: !!activo }));
}

// panel bajo el boton de descarga
function orgHContablePanel(x) {
  let h = `<div class="card" style="margin:8px 0;border-color:#1e3a8a"><div style="font-weight:700;color:#1e3a8a">📒 Hoja contable (plantilla de Contabilidad)</div>
    <div class="mut" style="margin:4px 0 8px">Una fila por artículo de cada ingreso de tu archivo, con familia, referencia, subfamilia, cuenta contable, devolución y grupo de cuenta. Los artículos salen del <b>pedido de la web</b>; para 123 Wok, Casa de Nadie y Sin Par (sin pedidos en la web) carga el <b>informe de artículos</b> de Hiopos ("FACTURAS DE COMPRA").</div>
    <label class="s" style="display:inline-block;cursor:pointer;padding:6px 12px;border-radius:8px;background:#1e3a8a;color:#fff;font-weight:700">📦 Cargar informe de artículos de Hiopos<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="orgHInforme(this)"></label>
    <span class="mut" style="margin-left:8px">${orgC.informeNombre ? escAg(orgC.informeNombre) + (orgC.informe ? ' · ' + orgC.informe.length + ' líneas' : '') : 'opcional'}</span>
    ${orgC.informeError ? `<div class="err" style="margin-top:6px">${escAg(orgC.informeError)}</div>` : ''}
    ${orgC.error ? `<div class="err" style="margin-top:6px">${escAg(orgC.error)} <button class="s" onclick="orgHCargarContable(true)">Reintentar</button></div>` : ''}`;
  if (orgC.cargando || (!orgC.datos && !orgC.error)) { if (!orgC.cargando) orgHCargarContable(); return h + '<div class="mut" style="margin-top:6px">⏳ Cargando catálogo contable y pedidos...</div></div>'; }
  if (!x.contable) return h + '</div>';
  const C = x.contable, R = C.resumen;
  h += `<div class="mut" style="margin-top:8px">Ingresos: <b>${R.documentos}</b> (con artículos ${R.docsConArticulos}, sin artículos <b style="color:${R.docsSinArticulos ? '#b91c1c' : 'inherit'}">${R.docsSinArticulos}</b>) · líneas: <b>${R.lineas}</b> · con cuenta contable: <b>${R.conCuenta}</b> · sin cuenta: <b style="color:${R.sinCuenta ? '#b91c1c' : 'inherit'}">${R.sinCuenta}</b> · listas sin observaciones: <b>${R.listas}</b> · <a href="#" onclick="orgHVer('contable');return false">ver la hoja</a></div>`;
  const props = orgCPropuestas(C);
  if (props.length) {
    const grupos = orgCGrupos();
    h += `<div style="font-weight:700;margin-top:10px">Artículos sin homologar por familia de Hiopos · confirma una regla para clasificarlos</div><div style="overflow:auto;max-height:36vh"><table><thead><tr><th>Familia (Hiopos)</th><th class="num">Líneas</th><th>Propuesta (del catálogo de Contabilidad)</th><th></th></tr></thead><tbody>` +
      props.map((p) => `<tr><td>${escAg(p.familia_hiopos)}</td><td class="num">${p.n}</td>` + (p.sinPropuesta
        ? `<td class="mut">${escAg(p.sinPropuesta)}</td><td><select onchange="orgCManual('${p.familia_norm}','${escAg(p.familia_hiopos).replace(/'/g, '&#39;')}',this)" style="width:auto;margin:0"><option value="">— elegir grupo —</option>${grupos.map((g, i) => `<option value="${i}">${escAg(g.grupo_cuenta)} · ${escAg(g.cuenta_contable)}</option>`).join('')}</select></td>`
        : `<td>${escAg(p.grupo_cuenta)} · cuenta <b>${escAg(p.cuenta_contable)}</b>${/SEDES/.test(p.grupo_cuenta) ? ' <span class="mut">(solo almacenes de sede)</span>' : ''}</td><td><button class="s" onclick="orgCConfirmar('${p.familia_norm}')">✔ Confirmar</button></td>`) + '</tr>').join('') + '</tbody></table></div>';
  }
  if (orgC.datos.reglas.length) h += `<div class="mut" style="margin-top:8px">Reglas por familia confirmadas: ${orgC.datos.reglas.map((r) => `<label style="white-space:nowrap;margin-right:10px"><input type="checkbox" style="width:auto;margin:0 3px 0 0" ${r.activo !== false ? 'checked' : ''} onchange="orgCActivar('${r.familia_norm}',this.checked)">${escAg(r.familia_hiopos)} → ${escAg(r.grupo_cuenta)} ${escAg(r.cuenta_contable)} <span style="opacity:.7">(${escAg(r.confirmado_por || '?')})</span></label>`).join('')}</div>`;
  return h + '</div>';
}
// vista previa de la hoja contable (12 columnas)
function orgHContableVista(x) {
  if (!x.contable) return '<div class="vacio">⏳ Cargando la hoja contable...</div>';
  const filas = x.contable.filas;
  return `<div style="font-weight:700;margin:6px 0">Vista previa · Contabilidad (${filas.length} líneas)</div><div style="overflow:auto;max-height:56vh"><table><thead><tr>${HojaContable.COLUMNAS.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>` +
    filas.slice(0, 400).map((f) => `<tr${f.obs ? ' style="background:#fff7ed"' : ''}>${f.celdas.map((c, i) => `<td${i === 11 ? ' style="color:#b91c1c;font-size:12px"' : ''}>${escAg(i === 1 && c ? String(c).split('-').reverse().join('/') : (c == null ? '' : c))}</td>`).join('')}</tr>`).join('') +
    `</tbody></table></div>${filas.length > 400 ? `<div class="mut">… y ${filas.length - 400} más (todas van en el Excel)</div>` : ''}`;
}
