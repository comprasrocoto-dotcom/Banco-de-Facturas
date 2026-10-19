// ============================================================
//  escaner-ui.js  -  pantalla «📄 Escanear» para la foto de la factura y de la cuenta de cobro (19/10/2026, pedido del usuario)
// ============================================================
// Despues de tomar la foto: la sede arrastra los 4 puntos a las esquinas de la hoja, ve el resultado enderezado y en
// blanco y negro (o color) y elige «✅ Usar este escaneo». Tambien puede usar la foto tal cual o cancelar.
// escanearFoto(file) -> Promise: { blob } (JPG escaneado) | 'original' (usar la foto sin escanear) | null (cancelo).
// El calculo esta en js/escaner.js (sin IA, todo en el celular). Nombres globales con prefijo esc / ESC.
const ESC = { img: null, esq: null, escala: 1, modo: 'bn', resolver: null, arrastre: -1, resultado: null };

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
        <button type="button" class="p" style="background:#15803d;border-color:#15803d" onclick="escUsar()">✅ Usar este escaneo</button>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:10px">
      <button type="button" onclick="escTerminar('original')">Usar la foto sin escanear</button>
      <button type="button" class="d" onclick="escTerminar(null)">✖ Cancelar</button>
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
      // copia de trabajo (lado mayor <= 2400 px): rapida y con detalle suficiente para la hoja
      const k = Math.min(1, 2400 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ESC.img = c; ESC.esq = Escaner.esquinasIniciales(c.width, c.height); ESC.resolver = resolver; ESC.resultado = null;
      const m = escModal(); m.style.display = 'flex';
      $('escPaso1').style.display = 'flex'; $('escPaso2').style.display = 'none'; $('escMsg').textContent = '';
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
      ESC.derecha = Escaner.enderezar(src, ESC.esq, 1600);
      escProcesar();
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
  $('escRes').src = c.toDataURL('image/jpeg', 0.85);
  $('escModoBn').className = ESC.modo === 'bn' ? 'p' : ''; $('escModoColor').className = ESC.modo === 'color' ? 'p' : '';
}
function escModo(m) { ESC.modo = m === 'color' ? 'color' : 'bn'; if (ESC.derecha) escProcesar(); }
function escAtras() { $('escPaso2').style.display = 'none'; $('escPaso1').style.display = 'flex'; $('escTitulo').textContent = '📄 Escanear: mueve los 4 puntos a las esquinas de la hoja'; escDibujar(); }
function escUsar() {
  if (!ESC.resultado) return;
  ESC.resultado.toBlob((b) => escTerminar(b ? { blob: b } : 'original'), 'image/jpeg', 0.85);
}
function escTerminar(valor) {
  const m = $('modalEsc'); if (m) m.style.display = 'none';
  const r = ESC.resolver; ESC.resolver = null; ESC.img = null; ESC.derecha = null; ESC.resultado = null;
  if (r) r(valor);
}
window.addEventListener('resize', () => { const m = document.getElementById('modalEsc'); if (m && m.style.display !== 'none' && ESC.img && $('escPaso1').style.display !== 'none') escDibujar(); });
