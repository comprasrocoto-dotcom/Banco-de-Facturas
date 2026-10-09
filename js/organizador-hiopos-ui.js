// ============================================================
//  organizador-hiopos-ui.js  -  modulo "📊 Organizador Hiopos" (barra de arriba; admin y analistas/pagos)  (09/10/2026)
//  Cargar el Excel/CSV de Facturas de compra de Hiopos -> clasificar por EVIDENCIA (reglas confirmadas por proveedor,
//  Banco de Facturas y reporte de la DIAN) -> vista previa y "Por revisar" (corregir y, si se quiere, guardar la regla)
//  -> descargar el Excel organizado (Documentos, Caja menor, Por revisar, Clasificacion, Resumen).
//  El archivo original no se toca; no se crea nada en Hiopos ni movimientos. Logica en js/organizador-hiopos.js. Sin IA.
//  Tablas: hiopos_contacto_regla (reglas, con historial en hiopos_regla_historial) e hiopos_organizador_ejecucion.
//  Usa las globales de index.html: $, SB, perfil, usuario, escAg, money, XLSX (SheetJS ya cargado).
// ============================================================
// pinta el modulo en su contenedor (#hioposRaiz)
function orgHPintar() { const c = document.getElementById('hioposRaiz'); if (c) pintarOrganizadorHiopos(c); }
let orgH = { nombre: '', lectura: null, reglas: new Map(), cargadas: false, ver: 'documentos', q: '', error: '', procesando: false,
  dian: null, dianNombre: '', dianError: '', banco: null, bancoError: '', correcciones: new Map(), huella: '', yaOrganizado: null,
  ejecuciones: [], verReglas: false, historial: [] };
const orgHUsuario = () => (perfil && perfil.nombre) || (usuario && usuario.email) || null;

async function orgHCargarReglas() {
  try {
    const { data, error } = await SB.from('hiopos_contacto_regla').select('*');
    if (error) throw new Error(error.message);
    orgH.reglas = new Map((data || []).map((r) => [r.contacto_norm, r]));
  } catch (e) { orgH.error = 'No pude leer las reglas de proveedores: ' + e.message; }
  try {
    const { data } = await SB.from('hiopos_organizador_ejecucion').select('id,huella,archivo,documentos,neto,usuario,creado_en').order('creado_en', { ascending: false }).limit(10);
    orgH.ejecuciones = data || [];
  } catch (e) { orgH.ejecuciones = []; }
  orgH.cargadas = true;
}
// Evidencia del Banco de Facturas (una vez): numeros de factura electronica con su emisor/NIT y los proveedores conocidos (nombre -> NIT)
async function orgHCargarBanco() {
  if (orgH.banco) return orgH.banco;
  const facturas = [], proveedores = [];
  try {
    for (let d = 0; ; d += 1000) {
      const { data, error } = await SB.from('facturas').select('documento,prefijo,folio,emisor,nit_emisor').range(d, d + 999);
      if (error) throw new Error(error.message);
      (data || []).forEach((f) => { facturas.push({ documento: f.documento, prefijo: f.prefijo, folio: f.folio, emisor: f.emisor, nit: f.nit_emisor, fuente: 'el Banco de Facturas' }); proveedores.push({ nombre: f.emisor, nit: f.nit_emisor }); });
      if (!data || data.length < 1000) break;
    }
    const { data: pv } = await SB.from('proveedores').select('nit,razon_social,nombre_comercial').limit(5000);
    (pv || []).forEach((p) => { proveedores.push({ nombre: p.razon_social, nit: p.nit }); if (p.nombre_comercial) proveedores.push({ nombre: p.nombre_comercial, nit: p.nit }); });
    const { data: np } = await SB.from('proveedor_nombre_pos').select('nit,nombre_pos');
    (np || []).forEach((p) => proveedores.push({ nombre: p.nombre_pos, nit: p.nit }));
    orgH.bancoError = '';
  } catch (e) { orgH.bancoError = 'No pude leer el Banco de Facturas (la clasificación queda solo con reglas y el reporte DIAN): ' + e.message; }
  orgH.banco = { facturas, proveedores };
  return orgH.banco;
}
const orgHReglasLista = () => [...orgH.reglas.values()];
function orgHCalcular() {
  if (!orgH.lectura) return null;
  const banco = orgH.banco || { facturas: [], proveedores: [] };
  const dianFacturas = (orgH.dian || []).map((d) => ({ doc: d.doc, emisor: d.emisor, nit: d.nit, fuente: 'el reporte de la DIAN' }));
  const evidencia = OrganizadorHiopos.armarEvidencia({ facturas: [...banco.facturas, ...dianFacturas], proveedores: banco.proveedores });
  const cl = OrganizadorHiopos.clasificar(orgH.lectura.filas, orgHReglasLista(), evidencia, orgH.correcciones);
  // (09/10/2026) base, impuesto y total contra la factura (reporte de la DIAN), si se cargo
  const comparacion = orgH.dian ? OrganizadorHiopos.compararConDian(orgH.lectura.filas, orgH.dian) : null;
  return { cl, R: OrganizadorHiopos.resumen(orgH.lectura, cl), comparacion };
}
async function orgHHuella(buf) {
  try { const h = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return ''; }
}

async function orgHArchivo(input) {
  const f = input.files && input.files[0]; if (!f) return;
  orgH.error = ''; orgH.lectura = null; orgH.nombre = f.name; orgH.ver = 'documentos'; orgH.correcciones = new Map(); orgH.yaOrganizado = null;
  try {
    const buf = await f.arrayBuffer();
    if (!buf.byteLength) throw new Error('El archivo está vacío.');
    orgH.huella = await orgHHuella(buf);
    let mejor = null;
    if (/\.(csv|txt)$/i.test(f.name)) {
      // (09/10/2026) CSV de Hiopos: lector propio (todo como texto; ";" y miles con punto). UTF-8, o Windows-1252 si trae tildes rotas
      let texto = new TextDecoder('utf-8').decode(buf);
      if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf);
      const l = OrganizadorHiopos.leerTabla(OrganizadorHiopos.leerCsv(texto));
      if (l.filaEncabezado > 0) mejor = l;
    } else if (/\.(xlsx|xls)$/i.test(f.name)) {
      const wb = XLSX.read(buf, { type: 'array' });
      // la hoja con el encabezado de Hiopos (normalmente "Documentos")
      for (const n of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
        const l = OrganizadorHiopos.leerTabla(aoa);
        if (l.filaEncabezado > 0 && (!mejor || l.filas.length > mejor.filas.length)) mejor = l;
      }
    } else throw new Error('Ese tipo de archivo no sirve: carga el Excel (.xlsx) o el CSV que bajas de Hiopos.');
    if (!mejor) throw new Error('No encontré el encabezado de Hiopos (Fecha Doc, Su Doc, Contacto, Neto...) en ninguna hoja. ¿Es el Excel de Facturas de compra?');
    if (!mejor.filas.length && !mejor.errores.length) throw new Error('El archivo tiene el encabezado de Hiopos pero ningún documento.');
    orgH.lectura = mejor; orgH.web = null;
    // ¿ya se organizo este mismo archivo? (solo aviso: organizar no crea nada, pero evita repetir el trabajo por error)
    if (orgH.huella) {
      try { const { data } = await SB.from('hiopos_organizador_ejecucion').select('archivo,usuario,creado_en,documentos').eq('huella', orgH.huella).order('creado_en', { ascending: false }).limit(1); orgH.yaOrganizado = (data && data[0]) || null; }
      catch (e) { orgH.yaOrganizado = null; }
    }
    await orgHCargarBanco();
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
      if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf);
      aoa = OrganizadorHiopos.leerCsv(texto);
    } else {
      const wb = XLSX.read(buf, { type: 'array' });
      aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    }
    const d = OrganizadorHiopos.leerDian(aoa);
    if (d.error) throw new Error(d.error);
    orgH.dian = d.registros;
    if (orgH.lectura) orgH.ver = 'dif';
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

// REGLAS confirmadas por proveedor (explicitas, editables, desactivables; cada cambio queda en hiopos_regla_historial)
async function orgHGuardarRegla(norm, contacto, cambios, nota) {
  const actual = orgH.reglas.get(norm) || { contacto_norm: norm, contacto: contacto || norm, cuenta_cobro: false, no_cuenta_cobro: false, caja_menor: false, activo: true };
  const nuevo = Object.assign({}, actual, cambios, { actualizado_por: orgHUsuario(), actualizado_en: new Date().toISOString() });
  if (cambios.cuenta_cobro === true) nuevo.no_cuenta_cobro = false;
  if (cambios.no_cuenta_cobro === true) nuevo.cuenta_cobro = false;
  if (nota) nuevo.nota = nota;
  const { error } = await SB.from('hiopos_contacto_regla').upsert(nuevo, { onConflict: 'contacto_norm' });
  if (error) { alert('No se pudo guardar la regla: ' + error.message); return false; }
  orgH.reglas.set(norm, nuevo);
  return true;
}
async function orgHMarcar(norm, campo, valor) {
  const fila = (orgH.lectura ? OrganizadorHiopos.contactos(orgH.lectura.filas) : []).find((c) => OrganizadorHiopos.contactoClave(c.contacto) === norm);
  await orgHGuardarRegla(norm, fila ? fila.contacto : null, { [campo]: !!valor });
  orgHPintar();
}
// Corregir la clasificacion de UN documento y ofrecer guardarla como regla del proveedor (solo si la persona lo confirma)
async function orgHCorregir(fila, campo, valor) {
  const x = orgH.lectura && orgH.lectura.filas.find((z) => z.fila === fila); if (!x) return;
  const que = campo === 'caja_menor' ? (valor ? 'PAGADO POR CAJA MENOR' : 'NO pagado por caja menor') : (valor ? 'CUENTA DE COBRO' : 'NO es cuenta de cobro');
  const regla = confirm('Documento ' + (x.v['Su Doc'] || '') + ' de ' + (x.v.Contacto || '') + ': ' + que + '.\n\n¿Guardar también como REGLA del proveedor (se aplicará a TODOS sus documentos en los próximos archivos)?\n\nAceptar = guardar la regla · Cancelar = solo este documento, en este archivo');
  if (regla) {
    const cambios = campo === 'caja_menor' ? { caja_menor: !!valor } : (valor ? { cuenta_cobro: true } : { no_cuenta_cobro: true });
    const ok = await orgHGuardarRegla(OrganizadorHiopos.contactoClave(x.v.Contacto), x.v.Contacto, cambios, 'confirmada desde ' + (x.v['Su Doc'] || 'un documento') + ' (' + (orgH.nombre || '') + ')');
    if (ok) orgH.correcciones.delete(fila);
  } else {
    const c = Object.assign({}, orgH.correcciones.get(fila) || {}, { [campo]: !!valor });
    orgH.correcciones.set(fila, c);
  }
  orgHPintar();
}
async function orgHVerReglas() {
  orgH.verReglas = !orgH.verReglas;
  if (orgH.verReglas) {
    try { const { data } = await SB.from('hiopos_regla_historial').select('contacto_norm,accion,antes,despues,usuario,en').order('en', { ascending: false }).limit(30); orgH.historial = data || []; }
    catch (e) { orgH.historial = []; }
  }
  orgHPintar();
}
async function orgHReglaCampo(norm, campo, valor) { await orgHGuardarRegla(norm, null, { [campo]: !!valor }); if (orgH.verReglas) { orgH.verReglas = false; await orgHVerReglas(); } else orgHPintar(); }

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
    // historial de ejecuciones (solo un registro de que se organizo; no toca Hiopos ni crea movimientos)
    try {
      const R = x.R;
      const fila = { huella: orgH.huella || 'sin-huella', archivo: orgH.nombre, documentos: R.validos, neto: R.neto.total, usuario: orgHUsuario(),
        resumen: { cuentasCobro: R.cuentasCobro, cajaMenor: R.cajaMenor, porRevisar: R.revision, errores: R.errores, porTipo: R.porTipo, distintosFactura: x.comparacion ? x.comparacion.porFila.size : null } };
      const { error } = await SB.from('hiopos_organizador_ejecucion').insert(fila);
      if (!error) { orgH.ejecuciones.unshift(Object.assign({ creado_en: new Date().toISOString() }, fila)); orgH.yaOrganizado = orgH.yaOrganizado || Object.assign({ creado_en: new Date().toISOString() }, fila); }
    } catch (e) { /* el Excel ya se descargo: el historial es solo informativo */ }
  } catch (e) { alert('No se pudo armar el Excel: ' + e.message); }
  if (btn) { btn.disabled = false; btn.textContent = '⬇ Descargar Excel organizado'; }
}
function orgHVer(v) { orgH.ver = v; orgHPintar(); }
function orgHBuscar(q) { orgH.q = q; const el = document.getElementById('orgHProvs'); if (el) el.innerHTML = orgHTablaProveedores(); }

const orgHCheck = (marcado, accion) => `<input type="checkbox" style="width:auto;margin:0" ${marcado ? 'checked' : ''} onchange="${accion}">`;
function orgHTablaProveedores() {
  const l = OrganizadorHiopos.contactos(orgH.lectura.filas).filter((c) => !orgH.q || (typeof SelectBuscable !== 'undefined' ? SelectBuscable.coincide(c.contacto, orgH.q) : c.contacto.toLowerCase().includes(orgH.q.toLowerCase())));
  if (!l.length) return '<div class="vacio">Ningún proveedor coincide.</div>';
  return `<table><thead><tr><th>Proveedor (Contacto)</th><th class="num">Docs</th><th class="num">Neto</th><th>Cuenta de cobro</th><th>NO es cuenta de cobro</th><th>Caja menor</th></tr></thead><tbody>` +
    l.map((c) => { const k = OrganizadorHiopos.contactoClave(c.contacto), r = orgH.reglas.get(k) || {}, off = r.activo === false;
      return `<tr${off ? ' style="opacity:.55" title="Regla desactivada"' : ''}><td>${escAg(c.contacto)}${off ? ' <span class="mut">(regla desactivada)</span>' : ''}</td><td class="num">${c.n}</td><td class="num">${money(c.neto)}</td>
        <td>${orgHCheck(r.cuenta_cobro, `orgHMarcar('${k}','cuenta_cobro',this.checked)`)}</td>
        <td>${orgHCheck(r.no_cuenta_cobro, `orgHMarcar('${k}','no_cuenta_cobro',this.checked)`)}</td>
        <td>${orgHCheck(r.caja_menor, `orgHMarcar('${k}','caja_menor',this.checked)`)}</td></tr>`; }).join('') + '</tbody></table>';
}
function orgHPanelReglas() {
  const l = orgHReglasLista().sort((a, b) => String(a.contacto).localeCompare(String(b.contacto)));
  const fecha = (t) => (t ? new Date(t).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const cambio = (h) => { const d = h.despues || {}, a = h.antes || {}; const k = ['cuenta_cobro', 'no_cuenta_cobro', 'caja_menor', 'activo'].filter((c) => h.accion === 'INSERT' ? d[c] : a[c] !== d[c]);
    return h.accion === 'DELETE' ? 'borrada' : k.map((c) => ({ cuenta_cobro: 'cuenta de cobro', no_cuenta_cobro: 'no es cuenta de cobro', caja_menor: 'caja menor', activo: 'activa' }[c] + ': ' + (d[c] ? 'sí' : 'no'))).join(', ') || 'sin cambio de reglas'; };
  return `<div class="card" style="margin:8px 0"><div style="font-weight:700">Reglas guardadas (${l.length}) · se aplican a todos los archivos</div>
    <div class="mut" style="margin:4px 0 8px">Una regla solo se crea cuando alguien la confirma. Desactívala si deja de aplicar (no se borra; queda el historial).</div>
    <div style="overflow:auto;max-height:40vh"><table><thead><tr><th>Proveedor</th><th>Cuenta de cobro</th><th>NO es cuenta de cobro</th><th>Caja menor</th><th>Activa</th><th>Confirmó</th><th>Fecha</th><th>Nota</th></tr></thead><tbody>` +
    (l.map((r) => `<tr${r.activo === false ? ' style="opacity:.55"' : ''}><td>${escAg(r.contacto)}</td>
      <td>${orgHCheck(r.cuenta_cobro, `orgHReglaCampo('${r.contacto_norm}','cuenta_cobro',this.checked)`)}</td>
      <td>${orgHCheck(r.no_cuenta_cobro, `orgHReglaCampo('${r.contacto_norm}','no_cuenta_cobro',this.checked)`)}</td>
      <td>${orgHCheck(r.caja_menor, `orgHReglaCampo('${r.contacto_norm}','caja_menor',this.checked)`)}</td>
      <td>${orgHCheck(r.activo !== false, `orgHReglaCampo('${r.contacto_norm}','activo',this.checked)`)}</td>
      <td>${escAg(r.actualizado_por || '')}</td><td>${fecha(r.actualizado_en)}</td><td class="mut">${escAg(r.nota || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="vacio">Todavía no hay reglas.</td></tr>') +
    `</tbody></table></div>
    ${orgH.historial.length ? `<div style="font-weight:700;margin-top:10px">Últimos cambios</div><div class="mut" style="font-size:12px">${orgH.historial.map((h) => `${fecha(h.en)} · ${escAg(h.usuario || '?')} · ${escAg(((h.despues || h.antes || {}).contacto) || h.contacto_norm)}: ${escAg(cambio(h))}`).join('<br>')}</div>` : ''}</div>`;
}

function pintarOrganizadorHiopos(c) {
  if (!orgH.cargadas) { c.innerHTML = '<div class="vacio">⏳ Cargando...</div>'; orgHCargarReglas().then(() => orgHPintar()); return; }
  const fechaCorta = (t) => (t ? new Date(t).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  let h = `<div class="card" style="margin:6px 0"><div class="emisor">📊 Organizador Hiopos</div>
    <div class="mut" style="margin:4px 0 10px">Carga el Excel o CSV de <b>Facturas de compra</b> que bajas de Hiopos. Se ordena en las 16 columnas de las planillas (INGRESO = Serie / Número, DETALLE = centro de costo según la serie). Las <b>cuentas de cobro</b> y los pagos de <b>caja menor</b> se marcan solo con evidencia (reglas confirmadas, Banco de Facturas, reporte de la DIAN, la nota del documento); lo dudoso queda en <b>Por revisar</b>. Tu archivo no se modifica y no se crea nada en Hiopos.</div>
    <label class="s" style="display:inline-block;cursor:pointer;padding:8px 14px;border-radius:8px;background:#0f766e;color:#fff;font-weight:700">📂 Cargar Excel o CSV de Hiopos<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="orgHArchivo(this)"></label>
    ${orgH.nombre ? `<span class="mut" style="margin-left:8px">${escAg(orgH.nombre)}</span>` : ''}
    <div style="margin-top:8px"><label class="s" style="display:inline-block;cursor:pointer;padding:6px 12px;border-radius:8px;background:#1e3a8a;color:#fff;font-weight:700">📄 Cargar reporte de la DIAN<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="orgHDian(this)"></label>
      <span class="mut" style="margin-left:8px">${orgH.dianNombre ? escAg(orgH.dianNombre) + (orgH.dian ? ' · ' + orgH.dian.length + ' facturas recibidas' : '') : 'Identifica las facturas electrónicas y compara la base, el impuesto y el total con cada factura.'}</span>
      ${orgH.dianError ? `<div class="err" style="margin-top:6px">${escAg(orgH.dianError)}</div>` : ''}</div>
    ${orgH.error ? `<div class="err" style="margin-top:8px">${escAg(orgH.error)}</div>` : ''}
    <div style="margin-top:8px"><button class="s" onclick="orgHVerReglas()">${orgH.verReglas ? 'Ocultar' : '⚙️ Ver'} reglas guardadas (${orgH.reglas.size})</button></div></div>`;
  if (orgH.verReglas) h += orgHPanelReglas();
  const x = orgHCalcular();
  if (!x) {
    if (orgH.ejecuciones.length) h += `<div class="card" style="margin:8px 0"><div style="font-weight:700">Últimos archivos organizados</div><div class="mut" style="font-size:12px">${orgH.ejecuciones.map((e) => `${fechaCorta(e.creado_en)} · ${escAg(e.usuario || '?')} · ${escAg(e.archivo || '')} · ${e.documentos || 0} documentos · ${money(e.neto || 0)}`).join('<br>')}</div></div>`;
    c.innerHTML = h; return;
  }
  const L = orgH.lectura, R = x.R;
  if (orgH.yaOrganizado) h += `<div class="err" style="background:#fffbeb;border:1px solid #f59e0b;color:#92400e;padding:8px 12px;border-radius:9px">⚠️ Este mismo archivo ya se organizó el ${fechaCorta(orgH.yaOrganizado.creado_en)}${orgH.yaOrganizado.usuario ? ' por ' + escAg(orgH.yaOrganizado.usuario) : ''}. Puedes volver a descargarlo (no se duplica nada: organizar no crea movimientos), pero revisa que no estés repitiendo el trabajo.</div>`;
  const tarjeta = (t, n, v, color, ver) => `<div class="card" style="flex:1;min-width:150px;margin:0;padding:10px 12px;cursor:${ver ? 'pointer' : 'default'};${color ? 'background:' + color + ';' : ''}${orgH.ver === ver ? 'outline:2px solid #0f766e;' : ''}" ${ver ? `onclick="orgHVer('${ver}')"` : ''}><div class="mut" style="font-size:12px">${t}</div><div style="font-size:20px;font-weight:800">${n}</div>${v != null ? `<div class="mut">${money(v)}</div>` : ''}</div>`;
  h += `<div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0">
    ${tarjeta('Documentos', R.validos, R.neto.total, '', 'documentos')}
    ${tarjeta('Cuentas de cobro', R.cuentasCobro, R.neto.cuentasCobro, '#fef3c7', 'cc')}
    ${tarjeta('Caja menor', R.cajaMenor, R.neto.cajaMenor, '#dbeafe', 'cm')}
    ${tarjeta('Por revisar', R.revision, null, R.revision ? '#ede9fe' : '', 'revision')}
    ${tarjeta('Errores de lectura', R.errores, null, R.errores ? '#fee2e2' : '', 'errores')}
    ${x.comparacion ? tarjeta('≠ Factura (modificar)', x.comparacion.porFila.size, null, x.comparacion.porFila.size ? '#fca5a5' : '#dcfce7', 'dif') : ''}</div>`;
  const T = OrganizadorHiopos.TIPO, TT = OrganizadorHiopos.TIPO_TXT;
  h += `<div class="mut" style="margin:-2px 0 8px">Tipo de documento: ${Object.values(T).map((t) => `${TT[t]}: <b>${R.porTipo[t]}</b>`).join(' · ')}${!orgH.dian && (R.porTipo[T.CONOCIDO] + R.porTipo[T.SIN]) ? ' — <b>carga el reporte de la DIAN</b> para identificar las facturas electrónicas' : ''}</div>`;
  if (orgH.bancoError) h += `<div class="err">${escAg(orgH.bancoError)}</div>`;
  if (x.comparacion) {
    const C = x.comparacion, n = C.porFila.size;
    const conDif = x.cl.documentos.filter((z) => C.porFila.has(z.fila));
    h += n ? `<div class="err" style="padding:10px 12px;border:2px solid #b91c1c;border-radius:9px;background:#fef2f2"><b>⚠️ ${n} documento(s) con BASE, IMPUESTO o TOTAL distinto a la factura: modifícalos en Hiopos.</b>
        <div style="margin-top:6px;font-weight:400">${conDif.slice(0, 15).map((z) => `• <b>${escAg(z.v.INGRESO || '')}</b> ${escAg(z.v['Su Doc'])} · ${escAg(z.v.Contacto)}: ${escAg(OrganizadorHiopos.textoDiferencia(C.porFila.get(z.fila)))}`).join('<br>')}${n > 15 ? `<br>… y ${n - 15} más (en la vista "≠ Factura" y en el Excel)` : ''}</div></div>`
      : `<div class="mut" style="color:#166534">✅ Base, impuesto y total iguales a la factura en los ${C.comparadas} documento(s) que están en el reporte de la DIAN.</div>`;
    if (C.sinFactura) h += `<div class="mut">${C.sinFactura} documento(s) no están en el reporte de la DIAN (no se pudieron comparar).</div>`;
    if (C.ambiguas) h += `<div class="mut">${C.ambiguas} documento(s) con el mismo número en varias facturas de la DIAN: no se compararon.</div>`;
  }
  if (L.faltan.length) h += `<div class="err">Faltan columnas en el archivo: <b>${escAg(L.faltan.join(', '))}</b>. Esas celdas quedan vacías (no se inventan).</div>`;
  // INGRESO (el FC de Hiopos) y DETALLE: de donde salieron y cuantos quedaron vacios
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
  h += `<div class="row" style="margin:10px 0"><button class="p" id="orgHBajar" onclick="orgHDescargar()">⬇ Descargar Excel organizado</button><span class="mut">Hojas: Documentos · Caja menor · Por revisar · Clasificación · Resumen</span></div>`;
  // vista previa
  const ver = orgH.ver;
  const botones = (z) => `<div style="white-space:nowrap">
      <button class="s" style="padding:3px 7px;font-size:12px" onclick="orgHCorregir(${z.fila},'cuenta_cobro',true)">✔ Cuenta de cobro</button>
      <button class="s" style="padding:3px 7px;font-size:12px" onclick="orgHCorregir(${z.fila},'cuenta_cobro',false)">✖ No es</button>
      <button class="s" style="padding:3px 7px;font-size:12px" onclick="orgHCorregir(${z.fila},'caja_menor',${!z.cajaMenor})">${z.cajaMenor ? '✖ No es caja menor' : '💵 Caja menor'}</button></div>`;
  let filas, titulo;
  if (ver === 'cm') { filas = x.cl.cajaMenor; titulo = 'Caja menor (también están en Documentos)'; }
  else if (ver === 'cc') { filas = x.cl.documentos.filter((z) => z.cuentaCobro); titulo = 'Cuentas de cobro'; }
  else if (ver === 'revision') {
    const porFila = new Map(x.cl.documentos.map((z) => [z.fila, z]));
    filas = [...x.cl.revision.map((z) => Object.assign({}, porFila.get(z.fila), { motivo: TT[z.tipo] + ': ' + z.motivo, falta: z.falta, acciones: true })),
      ...L.repetidas.map((z) => ({ v: z.v, motivo: 'Repetido: igual a la fila ' + z.igualA + ' (se incluyó una sola vez)' }))];
    titulo = 'Por revisar';
  }
  else if (ver === 'dif' && x.comparacion) { filas = x.cl.documentos.filter((z) => x.comparacion.porFila.has(z.fila)).map((z) => Object.assign({ motivo: OrganizadorHiopos.textoDiferencia(x.comparacion.porFila.get(z.fila)) }, z)); titulo = '≠ Factura: modificar en Hiopos'; }
  else if (ver === 'errores') { filas = L.errores.map((z) => ({ v: z.v || {}, motivo: z.motivo, fila: z.fila })); titulo = 'Errores de lectura'; }
  else { filas = x.cl.documentos; titulo = 'Documentos'; }
  const conMotivo = ['revision', 'errores', 'dif'].includes(ver), esDocs = !['revision', 'errores', 'dif', 'cm', 'cc'].includes(ver);
  const cols = ['Fecha Doc', 'Su Doc', 'Contacto', 'Almacén', 'Neto', 'INGRESO', 'DETALLE', 'Nota'];
  h += `<div style="font-weight:700;margin:6px 0">Vista previa · ${titulo} (${filas.length})</div>${ver === 'revision' ? '<div class="mut" style="margin-bottom:6px">Corrige con los botones: se te pregunta si la corrección es solo para este documento o una regla del proveedor.</div>' : ''}<div style="overflow:auto;max-height:52vh"><table><thead><tr>${conMotivo ? '<th>Motivo</th>' : ''}${ver === 'revision' ? '<th>Qué falta</th><th>Corregir</th>' : ''}${cols.map((k) => `<th${k === 'Neto' ? ' class="num"' : ''}>${k}</th>`).join('')}${esDocs ? '<th>Tipo (evidencia)</th>' : ''}</tr></thead><tbody>` +
    filas.slice(0, 300).map((z) => { const v = z.v || {}, bg = z.cuentaCobro && z.cajaMenor ? '#ede9fe' : (z.cajaMenor ? '#dbeafe' : (z.cuentaCobro ? '#fef3c7' : ''));
      return `<tr${bg ? ` style="background:${bg}"` : ''}>${conMotivo ? `<td>${escAg(z.motivo || '')}</td>` : ''}${ver === 'revision' ? `<td class="mut">${escAg(z.falta || '')}</td><td>${z.acciones ? botones(z) : ''}</td>` : ''}${cols.map((k) => `<td${k === 'Neto' ? ' class="num"' : ''}>${k === 'Neto' ? (v[k] == null ? '' : money(v[k])) : (k === 'Fecha Doc' && v[k] ? escAg(v[k].split('-').reverse().join('/')) : escAg(v[k] == null ? '' : v[k]))}</td>`).join('')}${esDocs ? `<td class="mut" style="font-size:12px">${escAg(TT[z.tipo] || '')}${z.evidencia ? ' (' + escAg(z.evidencia) + ')' : ''}</td>` : ''}</tr>`; }).join('') +
    `</tbody></table></div>${filas.length > 300 ? `<div class="mut">… y ${filas.length - 300} más (todas van en el Excel)</div>` : ''}`;
  // reglas por proveedor del archivo
  h += `<div class="card" style="margin:12px 0"><div style="font-weight:700">Proveedores de este archivo · reglas confirmadas</div>
    <div class="mut" style="margin:4px 0 8px">Marca solo lo que sabes con certeza: se guarda como regla del proveedor y se aplica a todos los archivos (queda quién y cuándo; se puede desactivar en "Ver reglas guardadas"). Si un documento de un proveedor con regla de cuenta de cobro aparece como factura electrónica, no se marca: va a Por revisar.</div>
    <input placeholder="🔎 buscar proveedor..." value="${escAg(orgH.q)}" oninput="orgHBuscar(this.value)" style="max-width:360px">
    <div id="orgHProvs" style="overflow:auto;max-height:42vh;margin-top:6px">${orgHTablaProveedores()}</div></div>`;
  c.innerHTML = h;
}
