// ============================================================
//  escaner-ui.js  -  pantalla «📄 Escanear» para la foto de la factura y de la cuenta de cobro (19/10/2026, pedido del usuario)
// ============================================================
// Despues de tomar la foto: la sede arrastra los 4 puntos a las esquinas de la hoja, ve el resultado enderezado y en
// blanco y negro (o color) y elige «✅ Usar este escaneo». Tambien puede usar la foto tal cual o cancelar.
// escanearFoto(file) -> Promise: { blob } (JPG escaneado) | 'original' (usar la foto sin escanear) | null (cancelo).
// El calculo esta en js/escaner.js (sin IA, todo en el celular). Nombres globales con prefijo esc / ESC.
const ESC = { img: null, esq: null, escala: 1, modo: 'bn', resolver: null, arrastre: -1, resultado: null, calidad: null };

function escModal() {
  let m = document.getElementById('modalEsc');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'modalEsc';
  m.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,.92);display:none;flex-direction:column;align-items:center;padding:10px;overflow:auto;touch-action:none';
  m.innerHTML = `
    <div style="color:#fff;font-weight:700;font-size:16px;text-align:center;margin:4px 0" id="escTitulo">📄 Escanear: mueve los 4 puntos a las esquinas de la hoja</div>
    <div id="escPaso1" style="display:flex;flex-direction:column;align-items:center;width:100%">
      <div id="escLienzo" style="position:relative;touch-action:none;user-select:none;-webkit-user-select:none">
        <canvas id="escCanvas" style="display:block;max-width:100%;border-radius:6px"></canvas>
        <svg id="escSvg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"><polygon id="escPoli" fill="rgba(34,197,94,.18)" stroke="#22c55e" stroke-width="2"></polygon></svg>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:10px">
        <button type="button" onclick="escToda()">↺ Toda la foto</button>
        <button type="button" class="p" onclick="escVer()">Siguiente: ver escaneo ▶</button>
      </div>
    </div>
    <div id="escPaso2" style="display:none;flex-direction:column;align-items:center;width:100%">
      <img id="escRes" alt="Factura escaneada" style="max-width:100%;max-height:68vh;background:#fff;border-radius:6px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:10px">
        <button type="button" id="escModoBn" onclick="escModo('bn')">⚫ Blanco y negro</button>
        <button type="button" id="escModoColor" onclick="escModo('color')">🎨 Color</button>
        <button type="button" onclick="escAtras()">↩ Ajustar esquinas</button>
        <button type="button" class="p" id="escBtnUsar" style="background:#15803d;border-color:#15803d" onclick="escUsar()">✅ Usar este escaneo</button>
      </div>
      <div id="escCalidad" style="display:none;max-width:560px;margin-top:10px;background:#fef2f2;color:#991b1b;border:2px solid #fca5a5;border-radius:10px;padding:10px 12px;font-size:14px"></div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:10px">
      <button type="button" id="escBtnOriginal" onclick="escTerminar('original')">Usar la foto sin escanear</button>
      <button type="button" class="d" onclick="escTerminar(null)">✖ Cancelar / tomar otra foto</button>
    </div>
    <div id="escMsg" style="color:#fde68a;font-size:13px;text-align:center;margin-top:6px"></div>`;
  document.body.appendChild(m);
  const lz = m.querySelector('#escLienzo');
  lz.addEventListener('pointerdown', escTocar);
  lz.addEventListener('pointermove', escMover);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => lz.addEventListener(ev, () => { ESC.arrastre = -1; }));
  return m;
}

function escanearFoto(file) {
  return new Promise((resolver) => {
    if (typeof Escaner === 'undefined' || !file || !/^image\//.test(file.type || '')) { resolver('original'); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // copia de trabajo (lado mayor <= 3200 px; antes 2400): con detalle para la letra pequeña de la factura
      const k = Math.min(1, 3200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ESC.img = c; ESC.esq = Escaner.esquinasIniciales(c.width, c.height); ESC.resolver = resolver; ESC.resultado = null;
      const m = escModal(); m.style.display = 'flex';
      $('escPaso1').style.display = 'flex'; $('escPaso2').style.display = 'none'; $('escMsg').textContent = '';
      $('escBtnOriginal').style.display = typeof CalidadFoto !== 'undefined' ? 'none' : '';   // (04/11/2026) siempre se escanea: asi se revisa la hoja
      $('escTitulo').textContent = '📄 Escanear: mueve los 4 puntos a las esquinas de la hoja';
      escDibujar();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolver('original'); };
    img.src = url;
  });
}

// pinta la foto ajustada a la pantalla, el contorno y los 4 puntos
function escDibujar() {
  const c = $('escCanvas'), src = ESC.img; if (!c || !src) return;
  const maxW = Math.min(window.innerWidth - 24, 900), maxH = Math.max(240, window.innerHeight * 0.66);
  ESC.escala = Math.min(maxW / src.width, maxH / src.height, 1);
  c.width = Math.round(src.width * ESC.escala); c.height = Math.round(src.height * ESC.escala);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const lz = $('escLienzo'); lz.style.width = c.width + 'px'; lz.style.height = c.height + 'px';
  const svg = $('escSvg'); svg.setAttribute('viewBox', '0 0 ' + c.width + ' ' + c.height);
  lz.querySelectorAll('.esc-punto').forEach((p) => p.remove());
  ESC.esq.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'esc-punto'; d.dataset.i = i;
    d.style.cssText = 'position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(34,197,94,.35);border:3px solid #22c55e;box-shadow:0 0 0 2px #fff;pointer-events:none';
    lz.appendChild(d);
  });
  escPintarPuntos();
}
function escPintarPuntos() {
  const s = ESC.escala, pts = ESC.esq.map((p) => [p[0] * s, p[1] * s]);
  $('escPoli').setAttribute('points', pts.map((p) => p.join(',')).join(' '));
  document.querySelectorAll('#escLienzo .esc-punto').forEach((d) => { const p = pts[Number(d.dataset.i)]; d.style.left = p[0] + 'px'; d.style.top = p[1] + 'px'; });
}
function escPos(ev) { const r = $('escCanvas').getBoundingClientRect(); return [(ev.clientX - r.left) / ESC.escala, (ev.clientY - r.top) / ESC.escala]; }
function escTocar(ev) {
  const p = escPos(ev); let mejor = -1, dmin = Infinity;
  ESC.esq.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < dmin) { dmin = d; mejor = i; } });
  if (dmin * ESC.escala > 70) return;   // muy lejos de un punto
  ESC.arrastre = mejor; try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) {}
  ev.preventDefault(); escMover(ev);
}
function escMover(ev) {
  if (ESC.arrastre < 0) return;
  const p = escPos(ev), W = ESC.img.width, H = ESC.img.height;
  ESC.esq[ESC.arrastre] = [Math.max(0, Math.min(W - 1, p[0])), Math.max(0, Math.min(H - 1, p[1]))];
  ev.preventDefault(); escPintarPuntos();
}
function escToda() { const W = ESC.img.width, H = ESC.img.height; ESC.esq = Escaner.esquinasIniciales(W, H, 0); escPintarPuntos(); }

// endereza + mejora y lo muestra
function escVer() {
  const W = ESC.img.width, H = ESC.img.height;
  if (!Escaner.valido(Escaner.ordenar(ESC.esq), W, H)) { $('escMsg').textContent = 'Los 4 puntos no forman la hoja: ponlos en las 4 esquinas.'; return; }
  $('escMsg').textContent = 'Procesando…';
  setTimeout(() => {
    try {
      const src = ESC.img.getContext('2d').getImageData(0, 0, W, H);
      ESC.derecha = Escaner.enderezar(src, ESC.esq, 2200);   // (27/10/2026) antes 1600: la letra pequeña quedaba ilegible
      escProcesar();
      escRevisarCalidad();
      $('escPaso1').style.display = 'none'; $('escPaso2').style.display = 'flex';
      $('escTitulo').textContent = '📄 Así queda escaneada';
      $('escMsg').textContent = '';
    } catch (e) { $('escMsg').textContent = 'No pude escanear la foto: ' + e.message; }
  }, 30);
}
function escProcesar() {
  const r = Escaner.mejorar(ESC.derecha, ESC.modo), c = document.createElement('canvas');
  c.width = r.width; c.height = r.height;
  c.getContext('2d').putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
  ESC.resultado = c;
  $('escRes').src = c.toDataURL('image/jpeg', 0.9);
  $('escModoBn').className = ESC.modo === 'bn' ? 'p' : ''; $('escModoColor').className = ESC.modo === 'color' ? 'p' : '';
}
// (04/11/2026, pedido del usuario: «si las fotos no estan nitidas y bien centradas no los deje seguir hasta que no este bien
// tomada») revisa la hoja enderezada (antes del blanco y negro): nitidez, luz, encuadre (las 4 esquinas) y resolucion.
// Si algo falla, «Usar este escaneo» queda bloqueado: se ajustan las esquinas o se toma otra foto. Logica en js/calidad-foto.js.
function escRevisarCalidad() {
  const caja = $('escCalidad'), btn = $('escBtnUsar');
  ESC.calidad = null;
  if (typeof CalidadFoto === 'undefined' || !ESC.derecha) { caja.style.display = 'none'; btn.disabled = false; btn.style.opacity = ''; return; }
  let problemas = [];
  try {
    const d = ESC.derecha, m = CalidadFoto.medir(...escGrisReducido(d));
    problemas = problemas.concat(CalidadFoto.revisarImagen(m).problemas,
      CalidadFoto.revisarEncuadre(Escaner.ordenar(ESC.esq), ESC.img.width, ESC.img.height).problemas,
      CalidadFoto.revisarTamano(d.width, d.height).problemas);
  } catch (e) { problemas = []; console.warn('calidad de la foto:', e); }   // si la revision falla, no se bloquea a nadie
  ESC.calidad = { ok: !problemas.length, problemas };
  btn.disabled = !!problemas.length; btn.style.opacity = problemas.length ? '.45' : '';
  if (!problemas.length) { caja.style.display = 'none'; return; }
  caja.style.display = 'block';
  caja.innerHTML = '<b>🚫 Esta foto no sirve todavía:</b><ul style="margin:6px 0 6px 18px;padding:0">' + problemas.map((p) => '<li>' + escAg(p) + '</li>').join('') +
    '</ul>Ajusta las esquinas (↩) o toma otra foto (✖). Hasta que quede bien no se puede seguir.';
}
// RGBA de la hoja -> [gris, W, H] con el lado corto <= 1000 px (asi se calibro la nitidez)
function escGrisReducido(d) {
  const k = Math.min(1, 1000 / Math.min(d.width, d.height)), c = document.createElement('canvas');
  c.width = d.width; c.height = d.height; c.getContext('2d').putImageData(new ImageData(d.data, d.width, d.height), 0, 0);
  const c2 = document.createElement('canvas'); c2.width = Math.max(1, Math.round(d.width * k)); c2.height = Math.max(1, Math.round(d.height * k));
  const x = c2.getContext('2d'); x.drawImage(c, 0, 0, c2.width, c2.height);
  const r = x.getImageData(0, 0, c2.width, c2.height);
  return [CalidadFoto.gris(r.data, r.width, r.height), r.width, r.height];
}
// para una foto suelta (sin escanear: la del papelito firmado al sellar): nitidez y luz. { ok, problemas }
function revisarFotoArchivo(file) {
  return new Promise((ok) => {
    if (typeof CalidadFoto === 'undefined' || !file || !/^image\//.test(file.type || '')) { ok({ ok: true, problemas: [] }); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const k = Math.min(1, 1000 / Math.min(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
        const r = x.getImageData(0, 0, c.width, c.height);
        ok(CalidadFoto.revisarImagen(CalidadFoto.medir(CalidadFoto.gris(r.data, r.width, r.height), r.width, r.height)));
      } catch (e) { ok({ ok: true, problemas: [] }); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); ok({ ok: false, problemas: ['No pude abrir la foto: tómala de nuevo.'] }); };
    img.src = url;
  });
}
function escModo(m) { ESC.modo = m === 'color' ? 'color' : 'bn'; if (ESC.derecha) escProcesar(); }
function escAtras() { $('escPaso2').style.display = 'none'; $('escPaso1').style.display = 'flex'; $('escTitulo').textContent = '📄 Escanear: mueve los 4 puntos a las esquinas de la hoja'; escDibujar(); }
function escUsar() {
  if (!ESC.resultado) return;
  if (ESC.calidad && !ESC.calidad.ok) { $('escMsg').textContent = 'La foto no está bien tomada: corrige lo que dice el recuadro rojo o toma otra.'; return; }
  ESC.resultado.toBlob((b) => escTerminar(b ? { blob: b } : 'original'), 'image/jpeg', 0.9);
}
function escTerminar(valor) {
  const m = $('modalEsc'); if (m) m.style.display = 'none';
  const r = ESC.resolver; ESC.resolver = null; ESC.img = null; ESC.derecha = null; ESC.resultado = null; ESC.calidad = null;
  if (r) r(valor);
}
window.addEventListener('resize', () => { const m = document.getElementById('modalEsc'); if (m && m.style.display !== 'none' && ESC.img && $('escPaso1').style.display !== 'none') escDibujar(); });
