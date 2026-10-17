// ============================================================
//  evaluacion-informe-sede.js  -  INFORME DE CUMPLIMIENTO POR SEDE para descargar (PDF) (16/10/2026, pedido del usuario)
// ============================================================
// Un PDF por sede con su cumplimiento en lo que le toca: 📋 montar pedidos y ✅ aceptar sus facturas (asignarse y sellar),
// con el mismo estilo de los cuadros del modulo (%, «X de Y» y barra) y la lista de facturas que debe corregir. Sirve para
// informar a cada sede. Botones: «⬇ Informe PDF» en cada sede y «⬇ Informes de todas las sedes (ZIP)». Usa html2canvas +
// jsPDF + JSZip (ya cargados en la pagina), igual que la orden de compra. Nombres globales con prefijo evInf.
function evInfFecha(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
function evInfColor(n) { return n == null ? '#64748b' : n >= 85 ? '#15803d' : n >= 70 ? '#b45309' : '#b91c1c'; }
function evInfEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// HTML del informe de UNA sede (s = resultado de Evaluacion.calcularSedes)
function evInfHtml(s, o) {
  const d = s.detalle || {}, marca = (o && o.marca) || '', desde = o.desde, hasta = o.hasta;
  const cuadro = (titulo, p, explica) => {
    const sin = p.pct == null, col = evInfColor(p.pct);
    return `<div style="flex:1;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;background:#fff">
      <div style="font-size:17px;color:#1e293b">${titulo}</div>
      <div style="font-size:40px;font-weight:800;color:${col};margin:4px 0">${sin ? 'Sin datos' : p.pct + '%'}</div>
      <div style="font-size:14px;color:#64748b">${sin ? 'no hubo movimiento en el período' : p.ok + ' de ' + p.total}</div>
      ${sin ? '' : `<div style="height:10px;background:#e5e7eb;border-radius:8px;overflow:hidden;margin-top:8px"><div style="height:100%;width:${p.pct}%;background:${col}"></div></div>`}
      <div style="font-size:12.5px;color:#475569;margin-top:10px;line-height:1.45">${explica}</div></div>`;
  };
  const tabla = (titulo, l, cols, vacio) => `<div style="margin-top:16px"><div style="font-weight:700;font-size:15px;color:#1e293b">${titulo}</div>
    ${l.length ? `<table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px"><tr style="background:#f1f5f9;text-align:left">${cols.map((c) => '<th style="padding:5px 6px">' + c[0] + '</th>').join('')}</tr>
      ${l.slice(0, 18).map((x) => '<tr style="border-bottom:1px solid #e2e8f0">' + cols.map((c) => '<td style="padding:4px 6px">' + evInfEsc(c[1](x)) + '</td>').join('') + '</tr>').join('')}</table>
      ${l.length > 18 ? `<div style="font-size:12px;color:#64748b;margin-top:3px">…y ${l.length - 18} más.</div>` : ''}` : `<div style="font-size:13px;color:#15803d;margin-top:4px">✅ ${vacio}</div>`}</div>`;
  return `<div style="width:794px;padding:34px 40px;font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#1e293b;box-sizing:border-box">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f766e;padding-bottom:12px">
      <div><div style="font-size:13px;color:#0f766e;font-weight:700;letter-spacing:.5px">BANCO DE FACTURAS · INFORME DE CUMPLIMIENTO</div>
        <div style="font-size:28px;font-weight:800;margin-top:4px">🏪 ${evInfEsc(s.nombre)}</div>
        <div style="font-size:14px;color:#64748b">${evInfEsc(marca)} · Período del ${evInfFecha(desde)} al ${evInfFecha(hasta)}</div></div>
      <div style="text-align:center"><div style="font-size:46px;font-weight:800;color:${evInfColor(s.puntaje)}">${s.puntaje}%</div><div style="font-size:12px;color:#64748b">cumplimiento general</div></div>
    </div>
    <div style="font-size:13.5px;color:#334155;margin:14px 0 12px;line-height:1.5">Estas son las dos tareas que le corresponden a la sede en el Banco de Facturas. Cada una se califica de 1 a 100%; la meta es <b>100% en las dos</b>.</div>
    <div style="display:flex;gap:14px">
      ${cuadro('📋 Montar pedidos', s.puntos.pedidos, 'Toda compra debe llegar con su pedido montado en la web <b>por la sede</b>. Cuenta en contra la factura que llega sin pedido o con un pedido montado por un analista.')}
      ${cuadro('✅ Aceptación de facturas', s.puntos.aceptacion, 'La sede debe <b>asignarse («Es mía») y sellar</b> sus facturas apenas le llegan. Cuenta en contra la factura que lleva más de 1 día hábil sin sellar o que tuvo que aceptar un analista.')}
    </div>
    ${tabla('⏳ Facturas asignadas a la sede que siguen SIN SELLAR', d.docsSinSellar || [], [['Factura', (x) => x.doc], ['Proveedor', (x) => x.emisor], ['Asignada', (x) => evInfFecha(x.asignada)], ['Días hábiles', (x) => x.dias]], 'No hay facturas pendientes por sellar.')}
    ${tabla('📋 Facturas que llegaron SIN pedido de la sede', d.docsSinPedido || [], [['Factura', (x) => x.doc], ['Proveedor', (x) => x.emisor], ['Ingresada', (x) => evInfFecha(x.fecha)]], 'Todas las facturas llegaron con su pedido.')}
    ${(d.docsPedAnalista || []).length ? tabla('🙋 Pedidos que montó un analista en lugar de la sede', d.docsPedAnalista, [['Factura', (x) => x.doc], ['Proveedor', (x) => x.emisor], ['Pedido', (x) => x.pedido], ['Lo montó', (x) => x.quien]], '') : ''}
    ${(d.docsAceptoOtro || []).length ? tabla('🙋 Facturas que aceptó un analista en lugar de la sede', d.docsAceptoOtro, [['Factura', (x) => x.doc], ['Proveedor', (x) => x.emisor], ['La aceptó', (x) => x.quien]], '') : ''}
    <div style="margin-top:20px;padding:10px 14px;border-radius:10px;background:#f0fdfa;border:1px solid #99f6e4;font-size:12.5px;color:#134e4a;line-height:1.5">
      👉 <b>Cómo mejorar:</b> monta cada pedido en la web antes de recibir la mercancía, y cuando llegue la factura asígnatela («Es mía») y séllala el mismo día (o tómale la foto desde el pedido).</div>
    <div style="margin-top:14px;font-size:11px;color:#94a3b8;display:flex;justify-content:space-between"><span>Banco de Facturas · Inversiones Rocoto</span><span>Generado el ${evInfFecha(new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10))}</span></div>
  </div>`;
}

// PDF de una sede -> { blob, nombre }
async function evInfPdf(s, o) {
  const cont = document.createElement('div');
  cont.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1';
  cont.innerHTML = evInfHtml(s, o);
  document.body.appendChild(cont);
  try {
    const canvas = await html2canvas(cont.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pw = 210, ph = 297, ih = canvas.height * pw / canvas.width;
    let y = 0, rest = ih;
    pdf.addImage(img, 'JPEG', 0, 0, pw, ih); rest -= ph;
    while (rest > 2) { y -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, y, pw, ih); rest -= ph; }
    const limpio = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return { blob: pdf.output('blob'), nombre: 'Cumplimiento_' + limpio(s.nombre) + (o.marca ? '_' + limpio(o.marca) : '') + '_' + o.desde + '_a_' + o.hasta + '.pdf' };
  } finally { cont.remove(); }
}
function evInfOpciones(s) { return { desde: EV.desde, hasta: EV.hasta, marca: typeof evNombreMarca === 'function' ? evNombreMarca(s.marca_id) : '' }; }
function evInfBajarBlob(blob, nombre) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }

async function evInfSede(sedeId) {
  const s = (EV.sedesRes || []).find((x) => Number(x.sede_id) === Number(sedeId)); if (!s) return;
  try { const r = await evInfPdf(s, evInfOpciones(s)); evInfBajarBlob(r.blob, r.nombre); } catch (e) { alert('No pude generar el informe: ' + (e.message || e)); }
}
async function evInfTodas() {
  const l = EV.sedesRes || []; if (!l.length) return;
  const b = $('btnInfTodas'); if (b) { b.disabled = true; b.textContent = '⏳ Generando 0 de ' + l.length + '…'; }
  try {
    const zip = new JSZip();
    for (let i = 0; i < l.length; i++) {
      const r = await evInfPdf(l[i], evInfOpciones(l[i]));
      zip.file(r.nombre, r.blob);
      if (b) b.textContent = '⏳ Generando ' + (i + 1) + ' de ' + l.length + '…';
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    evInfBajarBlob(blob, 'Cumplimiento_sedes_' + EV.desde + '_a_' + EV.hasta + '.zip');
  } catch (e) { alert('No pude generar los informes: ' + (e.message || e)); }
  finally { const bb = $('btnInfTodas'); if (bb) { bb.disabled = false; bb.textContent = '⬇ Informes de todas las sedes (ZIP)'; } }
}
