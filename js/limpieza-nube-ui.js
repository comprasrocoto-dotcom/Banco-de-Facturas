// ============================================================
//  LIBERAR ESPACIO EN LA NUBE  (03/11/2026, pedido del usuario: «dejar solo información almacenada de un mes»)
//  Administración → Agente (solo administrador). Primero se ve CUÁNTO se liberaría (limpieza_vista_previa); al confirmar queda una
//  solicitud que toma el vigilante del PC: copia cada archivo y registro al PC (C:\robot-hiopos\RESPALDO_NUBE) y SOLO ENTONCES
//  lo borra de la nube. Nunca toca lo de menos de 30 días ni facturas sin ingresar al ERP o sin enviar a contabilidad.
//  Base: supabase/limpieza_un_mes.sql ; PC: lib/limpieza-nube.js del agente.
// ============================================================
var LIMP = { prev: null, sol: [], t: null, viendo: false };

function limpMB(b) { const n = Number(b || 0) / 1048576; return (n >= 10 ? n.toFixed(0) : n.toFixed(1)) + ' MB'; }
function limpEsc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function limpFecha(t) { const x = t ? Date.parse(t) : NaN; return isNaN(x) ? '' : new Date(x - 5 * 3600000).toISOString().slice(0, 16).replace('T', ' '); }
const LIMP_TABLAS = { conciliacion_resultado: 'Resultados de conciliación', pdf_proceso: 'Paso a paso de PDFs', agente_aviso: 'Avisos del agente ya vistos', correo_cola: 'Correos ya enviados' };
const LIMP_ESTADO = { pendiente: '⏳ Esperando al vigilante del PC', corriendo: '🔄 Pasando al PC…', hecho: '✅ Lista', error: '⚠️ Se detuvo', cancelada: '✕ Cancelada' };

async function limpiezaPintar() {
  const caja = document.getElementById('limpiezaCaja'); if (!caja) return;
  try {
    const r = await SB.from('limpieza_solicitud').select('id,creada_en,pedida_por_nombre,dias,estado,tomada_por,tomada_en,terminada_en,avance,carpeta_pc,resumen').order('id', { ascending: false }).limit(3);
    if (r.error) { caja.innerHTML = ''; return; }   // base sin la tabla todavia: no se muestra nada
    LIMP.sol = r.data || [];
  } catch (e) { caja.innerHTML = ''; return; }
  caja.innerHTML = limpiezaHtml();
  clearTimeout(LIMP.t);
  if (LIMP.sol.some((s) => s.estado === 'pendiente' || s.estado === 'corriendo')) LIMP.t = setTimeout(limpiezaPintar, 10000);   // se actualiza solo mientras trabaja
}

function limpiezaHtml() {
  const activa = LIMP.sol.find((s) => s.estado === 'pendiente' || s.estado === 'corriendo');
  let h = `<div class="card" style="border-left:5px solid #0f766e;margin:8px 0"><div style="font-weight:700;color:#0f766e">🧹 Liberar espacio en la nube (dejar solo el último mes)</div>
    <div class="mut">Pasa al PC lo de <b>más de 30 días</b> que ya terminó su camino (facturas ingresadas al ERP <b>y</b> enviadas a contabilidad, sus fotos, PDF de pedidos facturados y archivos de lotes ya enviados) y los registros viejos del agente. Primero se COPIA en el PC (carpeta <b>RESPALDO_NUBE</b>) y solo después se borra de la nube. Las facturas y pedidos siguen apareciendo en la web; lo que no se podrá es abrir su PDF desde aquí (la web dirá en qué PC y carpeta quedó).</div>`;
  if (LIMP.prev) {
    const p = LIMP.prev, arch = p.archivos || [], regs = (p.registros || []).filter((x) => x.filas > 0);
    const tA = arch.reduce((s, x) => s + Number(x.bytes || 0), 0), tR = regs.reduce((s, x) => s + Number(x.bytes_aprox || 0), 0);
    h += `<table style="margin-top:8px;border-collapse:collapse;font-size:13px"><tr class="mut" style="text-align:left"><th style="padding:2px 10px 2px 0">Qué</th><th style="text-align:right;padding:2px 10px">Cantidad</th><th style="text-align:right">Espacio</th></tr>`
      + arch.map((x) => `<tr><td style="padding:2px 10px 2px 0">📄 ${limpEsc(x.categoria)}</td><td style="text-align:right;padding:2px 10px">${Number(x.archivos).toLocaleString('es-CO')} archivo(s)</td><td style="text-align:right">${limpMB(x.bytes)}</td></tr>`).join('')
      + regs.map((x) => `<tr><td style="padding:2px 10px 2px 0">🗂️ ${limpEsc(LIMP_TABLAS[x.tabla] || x.tabla)}</td><td style="text-align:right;padding:2px 10px">${Number(x.filas).toLocaleString('es-CO')} registro(s)</td><td style="text-align:right">≈ ${limpMB(x.bytes_aprox)}</td></tr>`).join('')
      + `<tr style="font-weight:700;border-top:1px solid var(--line)"><td>Total</td><td></td><td style="text-align:right">≈ ${limpMB(tA + tR)}</td></tr></table>`
      + (arch.length || regs.length ? '' : '<div class="mut" style="margin-top:6px">Por ahora no hay nada de más de 30 días que se pueda sacar.</div>');
  }
  h += `<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
    <button onclick="limpiezaVer()" ${LIMP.viendo ? 'disabled' : ''}>${LIMP.viendo ? '⏳ Calculando…' : '🔍 Ver cuánto se liberaría'}</button>
    ${LIMP.prev && !activa ? '<button class="p" onclick="limpiezaPedir()">🧹 Pasar al PC y borrar de la nube</button>' : ''}
    ${activa ? '<span class="mut">Ya hay una limpieza en curso: espera a que termine.</span>' : ''}</div>`;
  if (LIMP.sol.length) {
    h += `<div style="margin-top:10px">${LIMP.sol.map((s) => `<div style="border-top:1px solid var(--line);padding:5px 0">
      <b>#${s.id}</b> · ${limpFecha(s.creada_en)}${s.pedida_por_nombre ? ' · ' + limpEsc(s.pedida_por_nombre) : ''} · <b>${LIMP_ESTADO[s.estado] || limpEsc(s.estado)}</b>${s.tomada_por ? ' · PC ' + limpEsc(s.tomada_por) : ''}
      ${s.estado === 'pendiente' ? ` <button class="s" onclick="limpiezaCancelar(${s.id})">✕ Cancelar</button>` : ''}
      ${s.avance ? `<div class="mut">${limpEsc(s.avance)}</div>` : ''}
      ${s.carpeta_pc && (s.estado === 'hecho' || s.estado === 'error') ? `<div class="mut">Copia en el PC: <b>${limpEsc(s.carpeta_pc)}</b> (INDICE.csv dice qué es cada archivo)</div>` : ''}
      ${s.estado === 'pendiente' ? '<div class="mut">La toma el vigilante del PC (debe estar encendido). Si no arranca en unos minutos, revisa que el vigilante esté abierto.</div>' : ''}
    </div>`).join('')}</div>`;
  }
  return h + '</div>';
}

async function limpiezaVer() {
  LIMP.viendo = true; limpiezaRefrescar();
  try {
    const r = await SB.rpc('limpieza_vista_previa', { p_dias: 30 });
    if (r.error) throw new Error(r.error.message);
    LIMP.prev = r.data;
  } catch (e) { alert('No pude calcular: ' + e.message); }
  LIMP.viendo = false; limpiezaRefrescar();
}
function limpiezaRefrescar() { const caja = document.getElementById('limpiezaCaja'); if (caja) caja.innerHTML = limpiezaHtml(); }

async function limpiezaPedir() {
  const p = LIMP.prev; if (!p) return;
  const nA = (p.archivos || []).reduce((s, x) => s + Number(x.archivos || 0), 0), nR = (p.registros || []).reduce((s, x) => s + Number(x.filas || 0), 0);
  if (!nA && !nR) { alert('No hay nada de más de 30 días para sacar.'); return; }
  if (!confirm(`¿Pasar al PC y BORRAR DE LA NUBE ${nA.toLocaleString('es-CO')} archivo(s) y ${nR.toLocaleString('es-CO')} registro(s) de más de 30 días?\n\n• Primero se copia todo en el PC (carpeta RESPALDO_NUBE) y solo después se borra de la nube.\n• Esos PDF ya no se podrán abrir ni reenviar desde la web: quedan solo en el PC.\n• No se toca nada de menos de 30 días ni lo que siga pendiente.`)) return;
  const r = await SB.from('limpieza_solicitud').insert({ dias: 30, pedida_por_nombre: (perfil && perfil.nombre) || (usuario && usuario.email) || null });
  if (r.error) { alert(/duplicate|unique/i.test(r.error.message) ? 'Ya hay una limpieza en curso.' : 'No se pudo pedir: ' + r.error.message); }
  LIMP.prev = null; limpiezaPintar();
}

async function limpiezaCancelar(id) {
  if (!confirm('¿Cancelar esta limpieza? (todavía no ha empezado: no se ha borrado nada)')) return;
  const r = await SB.from('limpieza_solicitud').update({ estado: 'cancelada', avance: 'Cancelada antes de empezar' }).eq('id', id).eq('estado', 'pendiente').select('id');
  if (r.error || !(r.data && r.data.length)) alert('No se pudo cancelar' + (r.error ? ': ' + r.error.message : ': el vigilante ya la tomó.'));
  limpiezaPintar();
}

// Si un archivo ya se paso al PC, la web lo dice en vez de mostrar un error de la nube
async function msgArchivado(ruta) {
  if (!ruta) return '';
  try {
    const r = await SB.from('archivo_respaldo').select('pc,carpeta,archivado_en').eq('ruta', ruta).order('id', { ascending: false }).limit(1);
    const a = r.data && r.data[0];
    if (a) return `Este archivo ya no está en la nube: se pasó al PC ${a.pc || ''} el ${String(a.archivado_en || '').slice(0, 10)} para liberar espacio.\n\nBúscalo en ese PC en:\n${a.carpeta || 'RESPALDO_NUBE'}`;
  } catch (e) { /* sin tabla: mensaje normal */ }
  return '';
}
