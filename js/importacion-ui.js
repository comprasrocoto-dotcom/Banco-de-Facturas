// ============================================================
//  importacion-ui.js  -  PANTALLA "IMPORTAR BASES"  (19/09/2026)   (Admin -> 📥 Importar bases; solo el administrador)
//  Flujo:  1) elegir la base  2) subir el CSV  3) VISTA PREVIA (nada se guarda todavia)  4) aplicar.
//  No hace calculos ni decide duplicados: usa la logica pura de js/importacion.js y la funcion importar_maestro de la base.
//  Usa las globales de index.html: $, escAg, SB, traerTodo, provs, adminCargado, cargarAdmin, Conversiones, Importacion.
// ============================================================
const imp = { tipo: 'proveedores', archivo: '', leido: null, filas: [], resp: null, filtro: 'todo', tope: 200, ocupado: false, msg: '', msgMal: false, resultado: null, historial: null };

const IMP_COLOR = { nuevo: ['#166534', '#dcfce7'], actualiza: ['#1e3a8a', '#dbeafe'], igual: ['#475569', '#f1f5f9'], error: ['#991b1b', '#fee2e2'], sin_verificar: ['#92400e', '#fef3c7'] };
const impBadge = (estado) => { const c = IMP_COLOR[estado] || IMP_COLOR.igual; return `<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:700;color:${c[0]};background:${c[1]}">${escAg(Importacion.ETIQUETA[estado] || estado)}</span>`; };

function impPintar(cont) {
  if (!imp.historial && !imp.ocupado) impCargarHistorial();
  const T = Importacion.TIPOS[imp.tipo];
  let h = `<div class="card" style="margin:6px 0">
    <div style="font-weight:700;margin-bottom:6px">📥 Importar bases</div>
    <div class="mut" style="margin-bottom:10px">Sube un CSV para cargar o actualizar una base. Primero ves una <b>vista previa</b> (no se guarda nada); solo al confirmar se aplica. Nunca se borra nada y no se duplica: si ya existe, se actualiza.
      Orden recomendado: Proveedores → Productos → Conversiones → Máximos y mínimos → Catálogo.</div>
    <div class="row" style="margin-bottom:8px">${Importacion.ORDEN.map((t) => `<button class="chip${t === imp.tipo ? ' on' : ''}" onclick="impElegirTipo('${t}')">${escAg(Importacion.TIPOS[t].titulo.split(' (')[0])}</button>`).join('')}</div>
    <div style="margin:6px 0"><b>${escAg(T.titulo)}</b> <span class="mut">— ${escAg(T.ayuda)}</span></div>
    <div class="mut" style="margin-bottom:8px">Columnas: ${T.columnas.map((c) => `<code>${escAg(c.nombre)}</code>${c.req ? '<b>*</b>' : ''}`).join(' · ')} <span class="mut">(* obligatoria; se reconocen también otros nombres parecidos)</span></div>
    <div class="row">
      <button onclick="impDescargarPlantilla()">⬇ Plantilla CSV</button>
      ${imp.tipo === 'conversiones' ? `<button onclick="impDescargarFaltantes()" title="Las unidades de compra que hoy no se pueden convertir solas: ya vienen listas para llenar cantidad y unidad">⬇ Conversiones que faltan</button>` : ''}
      <label class="s" style="display:inline-block;padding:6px 14px;border-radius:8px;cursor:pointer;background:#12306b;color:#fff;font-weight:700">📂 Elegir archivo CSV<input type="file" id="impArchivo" accept=".csv,.txt,text/csv" style="display:none" onchange="impLeerArchivo(event)"></label>
      ${imp.archivo ? `<span class="mut">${escAg(imp.archivo)}</span>` : ''}
      <span class="sp"></span>
      ${imp.leido || imp.resultado ? '<button onclick="impCancelar()">✖ Limpiar</button>' : ''}
    </div>
    ${imp.msg ? `<div style="margin-top:10px;padding:8px 12px;border-radius:8px;${imp.msgMal ? 'background:#fee2e2;color:#991b1b' : 'background:#eff6ff;color:#1e3a8a'}">${imp.msg}</div>` : ''}
  </div>`;
  if (imp.ocupado) h += '<div class="vacio">⏳ Trabajando…</div>';
  if (imp.resultado) h += impResultadoHtml();
  else if (imp.leido) h += impPreviaHtml();
  h += impHistorialHtml();
  cont.innerHTML = h;
}

function impPreviaHtml() {
  const L = imp.leido;
  if (!L.ok) return `<div class="card" style="margin:6px 0;border:1px solid #fca5a5"><b style="color:#991b1b">No se puede leer el archivo</b><ul>${L.errores.map((e) => `<li>${escAg(e)}</li>`).join('')}</ul>
    <div class="mut">Descarga la plantilla para ver cómo debe venir.</div></div>`;
  const R = Importacion.resumen(imp.filas), T = Importacion.TIPOS[imp.tipo];
  const cuenta = { todo: R.total, nuevo: R.nuevos, actualiza: R.actualizados, igual: R.iguales, aviso: R.conAvisos, error: R.errores };
  const chip = (k, txt) => `<button class="chip${imp.filtro === k ? ' on' : ''}" onclick="impFiltrar('${k}')">${txt} (${cuenta[k]})</button>`;
  const visibles = imp.filas.filter((f) => imp.filtro === 'todo' || (imp.filtro === 'aviso' ? f.avisos.length : f.estado === imp.filtro));
  const col = T.columnas.map((c) => c.campo).filter((k) => L.columnas.some((x) => x.campo === k)).slice(0, 4);
  const conVerificar = !imp.resp;
  let h = `<div class="card" style="margin:6px 0">
    <div style="font-weight:700;margin-bottom:6px">Vista previa · ${R.total} fila${R.total === 1 ? '' : 's'} <span class="mut">(delimitador "${L.delimitador === '\t' ? 'tabulador' : escAg(L.delimitador)}"${L.ignoradas.length ? ` · columnas que no se usan: ${escAg(L.ignoradas.join(', '))}` : ''})</span></div>
    ${conVerificar ? '<div style="margin-bottom:8px;padding:8px 12px;border-radius:8px;background:#fef3c7;color:#92400e">⚠ No se pudo consultar la base: solo se revisó el archivo. No se puede aplicar hasta que la verificación funcione.</div>' : ''}
    <div class="row" style="margin-bottom:10px">${chip('todo', 'Todas')}${chip('nuevo', 'Nuevas')}${chip('actualiza', 'Actualizan')}${chip('igual', 'Sin cambios')}${chip('aviso', 'Con aviso')}${chip('error', 'Con error')}</div>
    <div class="row" style="margin-bottom:10px">
      <button class="p" ${R.aplicables && !conVerificar && !imp.ocupado ? '' : 'disabled'} onclick="impAplicar()">✅ Aplicar ${R.aplicables} fila${R.aplicables === 1 ? '' : 's'}</button>
      ${R.errores ? `<button onclick="impDescargarInforme()">⬇ Informe de errores (${R.errores})</button>` : ''}
      <span class="mut">${R.errores ? `Las ${R.errores} fila${R.errores === 1 ? '' : 's'} con error <b>no se cargan</b>. ` : ''}${R.iguales ? `${R.iguales} ya están igual y no se tocan.` : ''}</span>
    </div>
    ${visibles.length ? `<div style="overflow:auto"><table><thead><tr><th>Fila</th><th>Resultado</th>${col.map((k) => `<th>${escAg(T.columnas.find((c) => c.campo === k).nombre)}</th>`).join('')}<th>Detalle</th></tr></thead><tbody>
      ${visibles.slice(0, imp.tope).map((f) => `<tr><td class="mut">${f.n}</td><td>${impBadge(f.estado)}</td>${col.map((k) => `<td>${escAg(f.datos[k] == null ? '' : f.datos[k])}</td>`).join('')}
        <td>${f.errores.map((e) => `<div style="color:#991b1b">✖ ${escAg(e)}</div>`).join('')}${f.avisos.map((e) => `<div style="color:#92400e">⚠ ${escAg(e)}</div>`).join('')}${f.cambios.map((e) => `<div style="color:#1e3a8a">✎ ${escAg(e)}</div>`).join('')}</td></tr>`).join('')}
      </tbody></table></div>${visibles.length > imp.tope ? `<div class="mut" style="margin-top:6px">Mostrando ${imp.tope} de ${visibles.length}. <button style="padding:2px 10px" onclick="impVerMas()">ver más</button></div>` : ''}`
      : '<div class="vacio">No hay filas en este grupo.</div>'}
  </div>`;
  return h;
}

function impResultadoHtml() {
  const r = imp.resultado, s = r.resumen || {};
  return `<div class="card" style="margin:6px 0;border:1px solid #86efac"><div style="font-weight:700;color:#166534;margin-bottom:6px">✅ Listo: ${escAg(Importacion.TIPOS[r.tipo].titulo.split(' (')[0])}</div>
    <div class="row"><span class="badge">${s.nuevos || 0} nuevas</span><span class="badge">${s.actualizados || 0} actualizadas</span><span class="badge">${s.iguales || 0} sin cambios</span>${s.errores ? `<span class="badge" style="background:#fee2e2;color:#991b1b">${s.errores} con error (no se cargaron)</span>` : ''}</div>
    <div class="mut" style="margin-top:8px">La bitácora quedó registrada. Para ver los cambios en Nuevo pedido no hace falta recargar la página.</div></div>`;
}

function impHistorialHtml() {
  const H = imp.historial;
  if (!H || !H.length) return '';
  return `<div class="card" style="margin:6px 0"><div style="font-weight:700;margin-bottom:6px">Últimas importaciones</div><div style="overflow:auto"><table><thead><tr><th>Fecha</th><th>Base</th><th>Archivo</th><th>Nuevas</th><th>Actualizadas</th><th>Sin cambios</th><th>Omitidas</th><th>Quién</th></tr></thead><tbody>
    ${H.map((x) => `<tr><td class="mut">${escAg(new Date(x.creado_en).toLocaleString('es-CO', { timeZone: 'America/Bogota' }))}</td><td>${escAg((Importacion.TIPOS[x.tipo] || { titulo: x.tipo }).titulo.split(' (')[0])}</td><td class="mut">${escAg(x.archivo || '')}</td><td class="num">${x.nuevos}</td><td class="num">${x.actualizados}</td><td class="num">${x.iguales}</td><td class="num">${x.omitidos}</td><td class="mut">${escAg(x.usuario_nombre || '')}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

function impRepintar() { if (typeof adminVista !== 'undefined' && adminVista === 'import') pintarAdmin(); }
function impElegirTipo(t) { imp.tipo = t; impCancelar(); }
function impCancelar() { Object.assign(imp, { archivo: '', leido: null, filas: [], resp: null, filtro: 'todo', tope: 200, msg: '', msgMal: false, resultado: null }); impRepintar(); }
function impFiltrar(k) { imp.filtro = k; imp.tope = 200; impRepintar(); }
function impVerMas() { imp.tope += 300; impRepintar(); }

async function impCargarHistorial() {
  try {
    const { data } = await SB.from('importacion_lote').select('tipo,archivo,usuario_nombre,nuevos,actualizados,iguales,omitidos,creado_en').order('id', { ascending: false }).limit(10);
    imp.historial = data || [];
  } catch (e) { imp.historial = []; }
  impRepintar();
}

async function impLeerArchivo(ev) {
  const f = ev.target.files && ev.target.files[0]; if (!f) return;
  Object.assign(imp, { archivo: f.name, leido: null, filas: [], resp: null, resultado: null, filtro: 'todo', tope: 200, msg: '', msgMal: false, ocupado: true }); impRepintar();
  try {
    const texto = Importacion.decodificar(new Uint8Array(await f.arrayBuffer()));
    imp.leido = Importacion.leer(texto, imp.tipo);
    imp.filas = Importacion.combinar(imp.leido, null);
    if (imp.leido.ok) await impVerificar();
  } catch (e) { imp.msg = 'No se pudo leer el archivo: ' + escAg(e.message); imp.msgMal = true; }
  imp.ocupado = false; ev.target.value = ''; impRepintar();
}

// Pregunta a la base que haria con cada fila (NO guarda nada)
async function impVerificar() {
  const filas = Importacion.aServidor(imp.leido);
  imp.resp = null;
  if (!filas.length) { imp.resp = { filas: [] }; imp.filas = Importacion.combinar(imp.leido, imp.resp); return; }
  const { data, error } = await SB.rpc('importar_maestro', { p_tipo: imp.tipo, p_filas: filas, p_aplicar: false, p_archivo: imp.archivo });
  if (error) { imp.msg = 'La base no pudo revisar el archivo: ' + escAg(error.message); imp.msgMal = true; imp.filas = Importacion.combinar(imp.leido, null); return; }
  imp.resp = data; imp.filas = Importacion.combinar(imp.leido, data);
}

async function impAplicar() {
  if (!imp.leido || !imp.resp || imp.ocupado) return;
  const R = Importacion.resumen(imp.filas), T = Importacion.TIPOS[imp.tipo];
  if (!R.aplicables) return;
  const txt = `Vas a aplicar "${T.titulo.split(' (')[0]}":\n\n• ${R.nuevos} nueva${R.nuevos === 1 ? '' : 's'}\n• ${R.actualizados} que se actualiza${R.actualizados === 1 ? '' : 'n'}\n` +
    (R.errores ? `• ${R.errores} con error que NO se cargan\n` : '') + (R.conAvisos ? `• ${R.conAvisos} con aviso (revisa que sean correctas)\n` : '') + '\nNada se borra. ¿Aplicar?';
  if (!confirm(txt)) return;
  imp.ocupado = true; impRepintar();
  try {
    const { data, error } = await SB.rpc('importar_maestro', { p_tipo: imp.tipo, p_filas: Importacion.aServidor(imp.leido), p_aplicar: true, p_archivo: imp.archivo });
    if (error) { imp.msg = 'No se aplicó nada: ' + escAg(error.message); imp.msgMal = true; }
    else {
      imp.resultado = { tipo: imp.tipo, resumen: data.resumen }; imp.leido = null; imp.filas = []; imp.resp = null; imp.msg = ''; imp.msgMal = false; imp.archivo = '';
      provs = []; adminCargado = false; imp.historial = null;                       // Nuevo pedido y las listas del Admin se vuelven a leer con lo nuevo
      try { cargarAdmin(); } catch (e) { /* sin cambios en pantalla */ }
    }
  } catch (e) { imp.msg = 'No se aplicó nada: ' + escAg(e.message); imp.msgMal = true; }
  imp.ocupado = false; impRepintar();
}

// ---------------------------------------------------------------- descargas
function impDescargar(nombre, contenido) {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function impDescargarPlantilla() { impDescargar('plantilla_' + imp.tipo + '.csv', Importacion.plantilla(imp.tipo)); }
function impDescargarInforme() { if (imp.leido) impDescargar('errores_' + imp.tipo + '.csv', Importacion.informeErrores(imp.leido, imp.filas)); }
async function impDescargarFaltantes() {
  imp.ocupado = true; imp.msg = ''; impRepintar();
  try {
    const [a, m, um, uc, ua] = await Promise.all([traerTodo('articulos', 'articulo_hiopos,articulo_comercial,unimedida_compra', ['id']), traerTodo('maximos_minimos', 'articulo,subarticulo,almacen', ['id']),
      traerTodo('unidades_medida', 'formato,medida,unidad', ['id']), traerTodo('unidad_catalogo', 'canon,nombre,familia,base,factor_base,activo', ['canon']), traerTodo('unidad_alias', 'alias,canon,activo', ['alias'])]);
    const ctx = Conversiones.crearContexto({ unidadesMedida: um, catalogo: uc.filter((c) => c.activo !== false), alias: ua });
    const f = Conversiones.conversionesFaltantes(a, m, ctx);
    if (!f.length) { imp.msg = '✅ Todas las unidades de compra con máximo/mínimo ya se pueden convertir. No falta ninguna.'; imp.msgMal = false; }
    else { impDescargar('conversiones_que_faltan.csv', Importacion.plantillaFaltantes(f)); imp.msg = `Se descargó la lista: ${new Set(f.map((x) => x.presentacion)).size} unidades de compra sin conversión. Llena <b>cantidad</b> y <b>unidad</b> (ej.: 6 y uds) y súbela aquí.`; imp.msgMal = false; }
  } catch (e) { imp.msg = 'No se pudo armar la lista: ' + escAg(e.message); imp.msgMal = true; }
  imp.ocupado = false; impRepintar();
}
