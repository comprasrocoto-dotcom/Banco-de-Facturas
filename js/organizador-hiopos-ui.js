// ============================================================
//  organizador-hiopos-ui.js  -  modulo "📊 Organizador Hiopos" (barra de arriba; admin y analistas/pagos)  (09/10/2026)
//  Cargar el Excel de Facturas de compra de Hiopos -> vista previa -> marcar que proveedores cobran con CUENTA DE COBRO
//  y cuales se pagan por CAJA MENOR (se guarda en hiopos_contacto_regla) -> descargar el Excel organizado
//  (Documentos, Caja menor, Resumen). El archivo original no se toca. Logica en js/organizador-hiopos.js.
//  Usa las globales de index.html: $, SB, perfil, usuario, escAg, money, XLSX (SheetJS ya cargado).
// ============================================================
// pinta el modulo en su contenedor (#hioposRaiz)
function orgHPintar() { const c = document.getElementById('hioposRaiz'); if (c) pintarOrganizadorHiopos(c); }
let orgH = { nombre: '', lectura: null, reglas: new Map(), cargadas: false, ver: 'documentos', q: '', error: '', procesando: false, dian: null, dianNombre: '', dianError: '' };

async function orgHCargarReglas() {
  try {
    const { data, error } = await SB.from('hiopos_contacto_regla').select('contacto_norm,contacto,cuenta_cobro,caja_menor');
    if (error) throw new Error(error.message);
    orgH.reglas = new Map((data || []).map((r) => [r.contacto_norm, r]));
  } catch (e) { orgH.error = 'No pude leer las listas de proveedores: ' + e.message; }
  orgH.cargadas = true;
}
const orgHListas = () => ({
  cuentaCobro: [...orgH.reglas.values()].filter((r) => r.cuenta_cobro).map((r) => r.contacto),
  cajaMenor: [...orgH.reglas.values()].filter((r) => r.caja_menor).map((r) => r.contacto),
});
function orgHCalcular() {
  if (!orgH.lectura) return null;
  const cl = OrganizadorHiopos.clasificar(orgH.lectura.filas, orgHListas());
  // (09/10/2026) base, impuesto y total contra la factura (reporte de la DIAN), si se cargo
  const comparacion = orgH.dian ? OrganizadorHiopos.compararConDian(orgH.lectura.filas, orgH.dian) : null;
  return { cl, R: OrganizadorHiopos.resumen(orgH.lectura, cl), comparacion };
}

async function orgHArchivo(input) {
  const f = input.files && input.files[0]; if (!f) return;
  orgH.error = ''; orgH.lectura = null; orgH.nombre = f.name; orgH.ver = 'documentos';
  try {
    const buf = await f.arrayBuffer();
    let mejor = null;
    if (/\.(csv|txt)$/i.test(f.name)) {
      // (09/10/2026) CSV de Hiopos: lector propio (todo como texto; ";" y miles con punto). UTF-8, o Windows-1252 si trae tildes rotas
      let texto = new TextDecoder('utf-8').decode(buf);
      if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf);
      const l = OrganizadorHiopos.leerTabla(OrganizadorHiopos.leerCsv(texto));
      if (l.filaEncabezado > 0) mejor = l;
    } else {
      const wb = XLSX.read(buf, { type: 'array' });
      // la hoja con el encabezado de Hiopos (normalmente "Documentos")
      for (const n of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
        const l = OrganizadorHiopos.leerTabla(aoa);
        if (l.filaEncabezado > 0 && (!mejor || l.filas.length > mejor.filas.length)) mejor = l;
      }
    }
    if (!mejor) throw new Error('No encontré el encabezado de Hiopos (Fecha Doc, Su Doc, Contacto, Neto...) en ninguna hoja. ¿Es el Excel de Facturas de compra?');
    orgH.lectura = mejor; orgH.web = null;
    // (09/10/2026) INGRESO / DETALLE que el archivo no trae: se buscan en la web por el Su Doc
    if (mejor.filas.some((x) => !x.v.INGRESO || !x.v.DETALLE)) {
      try { orgH.web = OrganizadorHiopos.completarDesdeWeb(mejor, await orgHFacturasWeb()); }
      catch (e) { orgH.web = { error: e.message }; }
    }
  } catch (e) { orgH.error = e.message; }
  input.value = '';
  orgHPintar();
}

// (09/10/2026) reporte de la DIAN (Excel o CSV) -> orgH.dian (registros con total, impuestos y base de cada factura)
async function orgHDian(input) {
  const f = input.files && input.files[0]; if (!f) return;
  orgH.dianError = ''; orgH.dian = null; orgH.dianNombre = f.name;
  try {
    const buf = await f.arrayBuffer();
    let aoa;
    if (/\.(csv|txt)$/i.test(f.name)) {
      let texto = new TextDecoder('utf-8').decode(buf);
      if (texto.includes('\uFFFD')) texto = new TextDecoder('windows-1252').decode(buf);
      aoa = OrganizadorHiopos.leerCsv(texto);
    } else {
      const wb = XLSX.read(buf, { type: 'array' });
      aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    }
    const d = OrganizadorHiopos.leerDian(aoa);
    if (d.error) throw new Error(d.error);
    orgH.dian = d.registros;
    if (orgH.ver !== 'dif') orgH.ver = 'dif';
  } catch (e) { orgH.dianError = e.message; }
  input.value = '';
  orgHPintar();
}

// facturas de la web que ya tienen N° de ingreso (con el centro de costo elegido al amarrar) -> [{ sudoc, num_ingreso, centro_costo }]
async function orgHFacturasWeb() {
  const todas = [], cc = new Map();
  for (let d = 0; ; d += 1000) {
    const { data, error } = await SB.from('facturas').select('cufe,documento,prefijo,folio,num_ingreso').not('num_ingreso', 'is', null).range(d, d + 999);
    if (error) throw new Error(error.message);
    todas.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  try {
    const { data } = await SB.from('pedidos').select('factura_cufe,centro_costo').not('centro_costo', 'is', null);
    (data || []).forEach((p) => cc.set(p.factura_cufe, p.centro_costo));
  } catch (e) { /* sin centros: el DETALLE sale solo de la serie */ }
  const sola = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '');
  const r = [];
  for (const f of todas) {
    const claves = new Set([sola(f.documento), sola(f.prefijo) + sola(f.folio)].filter(Boolean));
    for (const k of claves) r.push({ sudoc: k, num_ingreso: f.num_ingreso, centro_costo: cc.get(f.cufe) || null });
  }
  return r;
}

async function orgHMarcar(norm, campo, valor) {
  const fila = (orgH.lectura ? OrganizadorHiopos.contactos(orgH.lectura.filas) : []).find((c) => OrganizadorHiopos.contactoClave(c.contacto) === norm);
  const actual = orgH.reglas.get(norm) || { contacto_norm: norm, contacto: fila ? fila.contacto : norm, cuenta_cobro: false, caja_menor: false };
  const nuevo = Object.assign({}, actual, { [campo]: !!valor, actualizado_por: (perfil && perfil.nombre) || (usuario && usuario.email) || null, actualizado_en: new Date().toISOString() });
  const { error } = await SB.from('hiopos_contacto_regla').upsert(nuevo, { onConflict: 'contacto_norm' });
  if (error) { alert('No se pudo guardar: ' + error.message); orgHPintar(); return; }
  orgH.reglas.set(norm, nuevo);
  orgHPintar();
}

let orgHExcelJS = null;
function orgHCargarExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (orgHExcelJS) return orgHExcelJS;
  orgHExcelJS = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = () => (window.ExcelJS ? res(window.ExcelJS) : rej(new Error('ExcelJS no cargó')));
    s.onerror = () => { orgHExcelJS = null; rej(new Error('No se pudo cargar la librería de Excel (revisa el internet)')); };
    document.head.appendChild(s);
  });
  return orgHExcelJS;
}
async function orgHDescargar() {
  const x = orgHCalcular(); if (!x) return;
  const btn = document.getElementById('orgHBajar'); if (btn) { btn.disabled = true; btn.textContent = '⏳ Armando el Excel...'; }
  try {
    const ExcelJS = await orgHCargarExcelJS();
    const ahora = new Date().toLocaleString('es-CO');
    const wb = OrganizadorHiopos.armarLibro(ExcelJS, { lectura: orgH.lectura, clasificacion: x.cl, nombreArchivo: orgH.nombre, ahora, comparacion: x.comparacion });
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = String(orgH.nombre || 'Hiopos').replace(/\.(xlsx|xls|csv)$/i, '') + ' - ORGANIZADO.xlsx';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  } catch (e) { alert('No se pudo armar el Excel: ' + e.message); }
  if (btn) { btn.disabled = false; btn.textContent = '⬇ Descargar Excel organizado'; }
}
function orgHVer(v) { orgH.ver = v; orgHPintar(); }
function orgHBuscar(q) { orgH.q = q; const el = document.getElementById('orgHProvs'); if (el) el.innerHTML = orgHTablaProveedores(); }

function orgHTablaProveedores() {
  const l = OrganizadorHiopos.contactos(orgH.lectura.filas).filter((c) => !orgH.q || (typeof SelectBuscable !== 'undefined' ? SelectBuscable.coincide(c.contacto, orgH.q) : c.contacto.toLowerCase().includes(orgH.q.toLowerCase())));
  if (!l.length) return '<div class="vacio">Ningún proveedor coincide.</div>';
  return `<table><thead><tr><th>Proveedor (Contacto)</th><th class="num">Docs</th><th class="num">Neto</th><th>Cuenta de cobro</th><th>Caja menor</th></tr></thead><tbody>` +
    l.map((c) => { const k = OrganizadorHiopos.contactoClave(c.contacto), r = orgH.reglas.get(k) || {};
      return `<tr><td>${escAg(c.contacto)}</td><td class="num">${c.n}</td><td class="num">${money(c.neto)}</td>
        <td><input type="checkbox" style="width:auto;margin:0" ${r.cuenta_cobro ? 'checked' : ''} onchange="orgHMarcar('${k}','cuenta_cobro',this.checked)"></td>
        <td><input type="checkbox" style="width:auto;margin:0" ${r.caja_menor ? 'checked' : ''} onchange="orgHMarcar('${k}','caja_menor',this.checked)"></td></tr>`; }).join('') + '</tbody></table>';
}

function pintarOrganizadorHiopos(c) {
  if (!orgH.cargadas) { c.innerHTML = '<div class="vacio">⏳ Cargando...</div>'; orgHCargarReglas().then(() => orgHPintar()); return; }
  let h = `<div class="card" style="margin:6px 0"><div class="emisor">📊 Organizador Hiopos</div>
    <div class="mut" style="margin:4px 0 10px">Carga el Excel de <b>Facturas de compra</b> que bajas de Hiopos. Se ordena en las 16 columnas de las planillas (INGRESO = Serie / Número, DETALLE = centro de costo según la serie), las <b>cuentas de cobro</b> quedan marcadas en la Nota y los pagos de <b>caja menor</b> pasan a su propia hoja. Tu archivo no se modifica.</div>
    <label class="s" style="display:inline-block;cursor:pointer;padding:8px 14px;border-radius:8px;background:#0f766e;color:#fff;font-weight:700">📂 Cargar Excel o CSV de Hiopos<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="orgHArchivo(this)"></label>
    ${orgH.nombre ? `<span class="mut" style="margin-left:8px">${escAg(orgH.nombre)}</span>` : ''}
    <div style="margin-top:8px"><label class="s" style="display:inline-block;cursor:pointer;padding:6px 12px;border-radius:8px;background:#1e3a8a;color:#fff;font-weight:700">📄 Cargar reporte de la DIAN<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="orgHDian(this)"></label>
      <span class="mut" style="margin-left:8px">${orgH.dianNombre ? escAg(orgH.dianNombre) + (orgH.dian ? ' · ' + orgH.dian.length + ' facturas recibidas' : '') : 'Para comparar la base, el impuesto y el total de cada documento con su factura.'}</span>
      ${orgH.dianError ? `<div class="err" style="margin-top:6px">${escAg(orgH.dianError)}</div>` : ''}</div>
    ${orgH.error ? `<div class="err" style="margin-top:8px">${escAg(orgH.error)}</div>` : ''}</div>`;
  const x = orgHCalcular();
  if (!x) { c.innerHTML = h; return; }
  const L = orgH.lectura, R = x.R;
  const tarjeta = (t, n, v, color, ver) => `<div class="card" style="flex:1;min-width:150px;margin:0;padding:10px 12px;cursor:${ver ? 'pointer' : 'default'};${color ? 'background:' + color + ';' : ''}${orgH.ver === ver ? 'outline:2px solid #0f766e;' : ''}" ${ver ? `onclick="orgHVer('${ver}')"` : ''}><div class="mut" style="font-size:12px">${t}</div><div style="font-size:20px;font-weight:800">${n}</div>${v != null ? `<div class="mut">${money(v)}</div>` : ''}</div>`;
  h += `<div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0">
    ${tarjeta('Leídos', R.leidos, null, '', '')}
    ${tarjeta('Documentos', x.cl.documentos.length, R.neto.documentos, '', 'documentos')}
    ${tarjeta('Cuentas de cobro', R.cuentasCobro, R.neto.cuentasCobro, '#fef3c7', 'cc')}
    ${tarjeta('Caja menor', R.cajaMenor, R.neto.cajaMenor, '#dbeafe', 'cm')}
    ${tarjeta('Para revisar', R.revision, null, R.revision ? '#ede9fe' : '', 'revision')}
    ${tarjeta('Errores de lectura', R.errores, null, R.errores ? '#fee2e2' : '', 'errores')}
    ${x.comparacion ? tarjeta('≠ Factura (modificar)', x.comparacion.porFila.size, null, x.comparacion.porFila.size ? '#fca5a5' : '#dcfce7', 'dif') : ''}</div>`;
  if (x.comparacion) {
    const C = x.comparacion, n = C.porFila.size;
    const conDif = [...x.cl.documentos, ...x.cl.cajaMenor].filter((z) => C.porFila.has(z.fila));
    h += n ? `<div class="err" style="padding:10px 12px;border:2px solid #b91c1c;border-radius:9px;background:#fef2f2"><b>⚠️ ${n} documento(s) con BASE, IMPUESTO o TOTAL distinto a la factura: modifícalos en Hiopos.</b>
        <div style="margin-top:6px;font-weight:400">${conDif.slice(0, 15).map((z) => `• <b>${escAg(z.v.INGRESO || '')}</b> ${escAg(z.v['Su Doc'])} · ${escAg(z.v.Contacto)}: ${escAg(OrganizadorHiopos.textoDiferencia(C.porFila.get(z.fila)))}`).join('<br>')}${n > 15 ? `<br>… y ${n - 15} más (en la vista "≠ Factura" y en el Excel)` : ''}</div></div>`
      : `<div class="mut" style="color:#166534">✅ Base, impuesto y total iguales a la factura en los ${C.comparadas} documento(s) que están en el reporte de la DIAN.</div>`;
    if (C.sinFactura) h += `<div class="mut">${C.sinFactura} documento(s) no están en el reporte de la DIAN (no se pudieron comparar).</div>`;
    if (C.ambiguas) h += `<div class="mut">${C.ambiguas} documento(s) con el mismo número en varias facturas de la DIAN: no se compararon.</div>`;
  }
  if (L.faltan.length) h += `<div class="err">Faltan columnas en el archivo: <b>${escAg(L.faltan.join(', '))}</b>. Esas celdas quedan vacías (no se inventan).</div>`;
  // (09/10/2026) INGRESO (el FC de Hiopos) y DETALLE: de donde salieron y cuantos quedaron vacios
  const W = orgH.web || {};
  if (!L.ingresoDe) h += `<div class="err">Tu Excel no trae la columna <b>Serie / Número</b> (el FC de Hiopos, ej. FC.BAR / 1890). En Hiopos, en la lista de Facturas de compra, muestra esa columna antes de exportar.${W.ingresos ? ` Mientras tanto se tomaron <b>${W.ingresos}</b> de la web (facturas que ya tienen N° de ingreso).` : ''}</div>`;
  else if (W.ingresos) h += `<div class="mut">INGRESO tomado de la web en ${W.ingresos} documento(s) que venían sin él.</div>`;
  if (W.error) h += `<div class="err">No pude buscar en la web los INGRESOS que faltan: ${escAg(W.error)}</div>`;
  if (L.totalArchivo != null) { const d = Math.round((R.neto.total - L.totalArchivo) * 100) / 100;
    h += d === 0 ? `<div class="mut" style="color:#166534">✅ El total organizado (${money(R.neto.total)}) cuadra con el total del archivo de Hiopos.</div>`
      : `<div class="err">El total organizado (${money(R.neto.total)}) NO cuadra con el del archivo de Hiopos (${money(L.totalArchivo)}): diferencia ${money(d)}. Revisa errores de lectura y repetidos.</div>`; }
  if (R.sinIngreso) h += `<div class="mut">⚠️ ${R.sinIngreso} documento(s) quedan <b>sin INGRESO</b> (ni en el archivo ni en la web).</div>`;
  if (R.sinDetalle) h += `<div class="mut">⚠️ ${R.sinDetalle} documento(s) quedan <b>sin DETALLE</b>: su serie no dice el centro de costo (FCRC/FCAR) o no tienen INGRESO.</div>`;
  if (L.noUsadas.length) h += `<div class="mut">Columnas del archivo que no van en la planilla: ${escAg(L.noUsadas.join(', '))}</div>`;
  h += `<div class="row" style="margin:10px 0"><button class="p" id="orgHBajar" onclick="orgHDescargar()">⬇ Descargar Excel organizado</button><span class="mut">Hojas: Documentos · Caja menor · Resumen</span></div>`;
  // vista previa
  const ver = orgH.ver;
  let filas, titulo;
  if (ver === 'cm') { filas = x.cl.cajaMenor; titulo = 'Caja menor'; }
  else if (ver === 'cc') { filas = x.cl.documentos.filter((z) => z.cuentaCobro); titulo = 'Cuentas de cobro'; }
  else if (ver === 'revision') { filas = [...x.cl.revision.map((z) => Object.assign({ motivo: z.motivo }, x.cl.cajaMenor.find((y) => y.fila === z.fila) || { v: z.v })), ...L.repetidas.map((z) => ({ v: z.v, motivo: 'Repetido: igual a la fila ' + z.igualA })) ]; titulo = 'Para revisar'; }
  else if (ver === 'dif' && x.comparacion) { filas = [...x.cl.documentos, ...x.cl.cajaMenor].filter((z) => x.comparacion.porFila.has(z.fila)).map((z) => Object.assign({ motivo: OrganizadorHiopos.textoDiferencia(x.comparacion.porFila.get(z.fila)) }, z)); titulo = '≠ Factura: modificar en Hiopos'; }
  else if (ver === 'errores') { filas = L.errores.map((z) => ({ v: z.v || {}, motivo: z.motivo, fila: z.fila })); titulo = 'Errores de lectura'; }
  else { filas = x.cl.documentos; titulo = 'Documentos'; }
  const cols = ['Fecha Doc', 'Su Doc', 'Contacto', 'Almacén', 'Neto', 'Pendiente', 'INGRESO', 'DETALLE', 'Nota'];
  h += `<div style="font-weight:700;margin:6px 0">Vista previa · ${titulo} (${filas.length})</div><div style="overflow:auto;max-height:46vh"><table><thead><tr>${(ver === 'revision' || ver === 'errores' || ver === 'dif') ? '<th>Motivo</th>' : ''}${cols.map((k) => `<th${['Neto', 'Pendiente'].includes(k) ? ' class="num"' : ''}>${k}</th>`).join('')}</tr></thead><tbody>` +
    filas.slice(0, 300).map((z) => { const v = z.v || {}, bg = z.cuentaCobro && z.cajaMenor ? '#ede9fe' : (z.cajaMenor ? '#dbeafe' : (z.cuentaCobro ? '#fef3c7' : ''));
      return `<tr${bg ? ` style="background:${bg}"` : ''}>${z.motivo ? `<td>${escAg(z.motivo)}</td>` : ''}${cols.map((k) => `<td${['Neto', 'Pendiente'].includes(k) ? ' class="num"' : ''}>${['Neto', 'Pendiente'].includes(k) ? (v[k] == null ? '' : money(v[k])) : (k === 'Fecha Doc' && v[k] ? escAg(v[k].split('-').reverse().join('/')) : escAg(v[k] == null ? '' : v[k]))}</td>`).join('')}</tr>`; }).join('') +
    `</tbody></table></div>${filas.length > 300 ? `<div class="mut">… y ${filas.length - 300} más (todas van en el Excel)</div>` : ''}`;
  // listas por proveedor
  h += `<div class="card" style="margin:12px 0"><div style="font-weight:700">Proveedores de este archivo · ¿quién cobra con cuenta de cobro y a quién se le paga por caja menor?</div>
    <div class="mut" style="margin:4px 0 8px">Se guarda al marcar y se aplica igual a todos los Excel que organices. Si un proveedor está en las dos listas, va en Caja menor y queda para revisión.</div>
    <input placeholder="🔎 buscar proveedor..." value="${escAg(orgH.q)}" oninput="orgHBuscar(this.value)" style="max-width:360px">
    <div id="orgHProvs" style="overflow:auto;max-height:42vh;margin-top:6px">${orgHTablaProveedores()}</div></div>`;
  c.innerHTML = h;
}
