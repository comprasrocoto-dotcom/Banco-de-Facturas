// ============================================================
//  organizador-hiopos-ui.js  -  Admin > "📊 Organizador Hiopos"  (09/10/2026)
//  Cargar el Excel de Facturas de compra de Hiopos -> vista previa -> marcar que proveedores cobran con CUENTA DE COBRO
//  y cuales se pagan por CAJA MENOR (se guarda en hiopos_contacto_regla) -> descargar el Excel organizado
//  (Documentos, Caja menor, Resumen). El archivo original no se toca. Logica en js/organizador-hiopos.js.
//  Usa las globales de index.html: $, SB, perfil, usuario, escAg, money, XLSX (SheetJS ya cargado).
// ============================================================
let orgH = { nombre: '', lectura: null, reglas: new Map(), cargadas: false, ver: 'documentos', q: '', error: '', procesando: false };

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
  return { cl, R: OrganizadorHiopos.resumen(orgH.lectura, cl) };
}

async function orgHArchivo(input) {
  const f = input.files && input.files[0]; if (!f) return;
  orgH.error = ''; orgH.lectura = null; orgH.nombre = f.name; orgH.ver = 'documentos';
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    // la hoja con el encabezado de Hiopos (normalmente "Documentos")
    let mejor = null;
    for (const n of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      const l = OrganizadorHiopos.leerTabla(aoa);
      if (l.filaEncabezado > 0 && (!mejor || l.filas.length > mejor.filas.length)) mejor = l;
    }
    if (!mejor) throw new Error('No encontré el encabezado de Hiopos (Fecha Doc, Su Doc, Contacto, Neto...) en ninguna hoja. ¿Es el Excel de Facturas de compra?');
    orgH.lectura = mejor;
  } catch (e) { orgH.error = e.message; }
  input.value = '';
  pintarAdmin();
}

async function orgHMarcar(norm, campo, valor) {
  const fila = (orgH.lectura ? OrganizadorHiopos.contactos(orgH.lectura.filas) : []).find((c) => OrganizadorHiopos.contactoClave(c.contacto) === norm);
  const actual = orgH.reglas.get(norm) || { contacto_norm: norm, contacto: fila ? fila.contacto : norm, cuenta_cobro: false, caja_menor: false };
  const nuevo = Object.assign({}, actual, { [campo]: !!valor, actualizado_por: (perfil && perfil.nombre) || (usuario && usuario.email) || null, actualizado_en: new Date().toISOString() });
  const { error } = await SB.from('hiopos_contacto_regla').upsert(nuevo, { onConflict: 'contacto_norm' });
  if (error) { alert('No se pudo guardar: ' + error.message); pintarAdmin(); return; }
  orgH.reglas.set(norm, nuevo);
  pintarAdmin();
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
    const wb = OrganizadorHiopos.armarLibro(ExcelJS, { lectura: orgH.lectura, clasificacion: x.cl, nombreArchivo: orgH.nombre, ahora });
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = String(orgH.nombre || 'Hiopos').replace(/\.(xlsx|xls|csv)$/i, '') + ' - ORGANIZADO.xlsx';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  } catch (e) { alert('No se pudo armar el Excel: ' + e.message); }
  if (btn) { btn.disabled = false; btn.textContent = '⬇ Descargar Excel organizado'; }
}
function orgHVer(v) { orgH.ver = v; pintarAdmin(); }
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
  if (!orgH.cargadas) { c.innerHTML = '<div class="vacio">⏳ Cargando...</div>'; orgHCargarReglas().then(() => pintarAdmin()); return; }
  let h = `<div class="card" style="margin:6px 0"><div class="emisor">📊 Organizador Hiopos</div>
    <div class="mut" style="margin:4px 0 10px">Carga el Excel de <b>Facturas de compra</b> que bajas de Hiopos. Se ordena en las 16 columnas de las planillas (INGRESO = Serie / Número, DETALLE = centro de costo según la serie), las <b>cuentas de cobro</b> quedan marcadas en la Nota y los pagos de <b>caja menor</b> pasan a su propia hoja. Tu archivo no se modifica.</div>
    <label class="s" style="display:inline-block;cursor:pointer;padding:8px 14px;border-radius:8px;background:#0f766e;color:#fff;font-weight:700">📂 Cargar Excel de Hiopos<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="orgHArchivo(this)"></label>
    ${orgH.nombre ? `<span class="mut" style="margin-left:8px">${escAg(orgH.nombre)}</span>` : ''}
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
    ${tarjeta('Errores de lectura', R.errores, null, R.errores ? '#fee2e2' : '', 'errores')}</div>`;
  if (L.faltan.length) h += `<div class="err">Faltan columnas en el archivo: <b>${escAg(L.faltan.join(', '))}</b>. Esas celdas quedan vacías (no se inventan).</div>`;
  if (L.noUsadas.length) h += `<div class="mut">Columnas del archivo que no van en la planilla: ${escAg(L.noUsadas.join(', '))}</div>`;
  h += `<div class="row" style="margin:10px 0"><button class="p" id="orgHBajar" onclick="orgHDescargar()">⬇ Descargar Excel organizado</button><span class="mut">Hojas: Documentos · Caja menor · Resumen</span></div>`;
  // vista previa
  const ver = orgH.ver;
  let filas, titulo;
  if (ver === 'cm') { filas = x.cl.cajaMenor; titulo = 'Caja menor'; }
  else if (ver === 'cc') { filas = x.cl.documentos.filter((z) => z.cuentaCobro); titulo = 'Cuentas de cobro'; }
  else if (ver === 'revision') { filas = [...x.cl.revision.map((z) => Object.assign({ motivo: z.motivo }, x.cl.cajaMenor.find((y) => y.fila === z.fila) || { v: z.v })), ...L.repetidas.map((z) => ({ v: z.v, motivo: 'Repetido: igual a la fila ' + z.igualA })) ]; titulo = 'Para revisar'; }
  else if (ver === 'errores') { filas = L.errores.map((z) => ({ v: z.v || {}, motivo: z.motivo, fila: z.fila })); titulo = 'Errores de lectura'; }
  else { filas = x.cl.documentos; titulo = 'Documentos'; }
  const cols = ['Fecha Doc', 'Su Doc', 'Contacto', 'Almacén', 'Neto', 'Pendiente', 'INGRESO', 'DETALLE', 'Nota'];
  h += `<div style="font-weight:700;margin:6px 0">Vista previa · ${titulo} (${filas.length})</div><div style="overflow:auto;max-height:46vh"><table><thead><tr>${(ver === 'revision' || ver === 'errores') ? '<th>Motivo</th>' : ''}${cols.map((k) => `<th${['Neto', 'Pendiente'].includes(k) ? ' class="num"' : ''}>${k}</th>`).join('')}</tr></thead><tbody>` +
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
