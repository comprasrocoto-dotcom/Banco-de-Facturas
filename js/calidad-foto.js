// ============================================================
//  calidad-foto.js  -  ¿la foto del documento esta NITIDA y BIEN TOMADA?  (04/11/2026, pedido del usuario:
//  «si las fotos no estan nitidas y bien centradas no los deje seguir hasta que no este bien tomada»)
// ============================================================
// Logica pura (sin pantalla, sin IA, sin servicios externos): todo se calcula en el celular / PC con los pixeles de la foto.
//  - NITIDEZ: en cada borde de la letra, que tan de golpe pasa de tinta a papel (comparado con el contraste de alrededor).
//    Nitida = 1-2 pixeles; borrosa o movida = el paso se alarga. No depende de cuanto texto tenga la hoja ni de la luz.
//  - LUZ: ni muy oscura ni quemada (blanca), y que se distinga la tinta del papel.
//  - ENCUADRE (con las 4 esquinas que marca la sede en «📄 Escanear»): la hoja ocupa buena parte de la foto, esta mas o
//    menos en el centro y no esta muy torcida ni muy de lado.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalidadFoto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Limites (calibrados con fotos reales de facturas y con hojas de prueba nitidas, movidas, oscuras y desenfocadas)
  const LIM = {
    agudezaMin: 0.45,      // menos = borrosa o movida (fotos reales nitidas: 0,55-0,77)
    bordesMin: 0.005,      // al menos 0,5 % de la hoja con borde de letra (si no: no se ve la letra: lejos, borrosa u oscura)
    brilloMin: 60, papelMax: 250,   // muy oscura / papel quemado (blanco puro por el flash o reflejo)
    areaMin: 0.30,         // la hoja debe ocupar al menos el 30 % de la foto
    centroMax: 0.20,       // el centro de la hoja a menos del 20 % del centro de la foto
    anguloMin: 60, anguloMax: 120,   // esquinas de la hoja entre 60° y 120° (no muy de lado)
    ladoMin: 700,          // la hoja enderezada: lado corto de al menos 700 px (se lee la letra pequeña)
  };

  // RGBA -> gris (0-255)
  function gris(data, W, H) {
    const g = new Float32Array(W * H);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    return g;
  }
  // desenfoque de caja 3x3 (bordes: se copian)
  function caja3(g, W, H) {
    const o = new Float32Array(g);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      o[i] = (g[i - W - 1] + g[i - W] + g[i - W + 1] + g[i - 1] + g[i] + g[i + 1] + g[i + W - 1] + g[i + W] + g[i + W + 1]) / 9;
    }
    return o;
  }
  const pct = (v, p) => { if (!v.length) return 0; v.sort((a, b) => a - b); return v[Math.floor(p * (v.length - 1))]; };
  // maximo y minimo en una ventana de (2R+1)x(2R+1) (en dos pasadas)
  function maxMin(s, W, H, R) {
    const mx1 = new Float32Array(W * H), mn1 = new Float32Array(W * H), mx = new Float32Array(W * H), mn = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let a = -1, b = 1e9;
      for (let k = -R; k <= R; k++) { const v = s[y * W + Math.min(W - 1, Math.max(0, x + k))]; if (v > a) a = v; if (v < b) b = v; }
      mx1[y * W + x] = a; mn1[y * W + x] = b;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let a = -1, b = 1e9;
      for (let k = -R; k <= R; k++) { const i = Math.min(H - 1, Math.max(0, y + k)) * W + x; if (mx1[i] > a) a = mx1[i]; if (mn1[i] < b) b = mn1[i]; }
      mx[y * W + x] = a; mn[y * W + x] = b;
    }
    return { mx, mn };
  }
  // mide una imagen en gris con el lado corto ~1000 px: { agudeza, agudezaH, agudezaV, bordes, brillo, papel }
  //  En cada borde de la letra se compara el salto de luz (de un pixel al siguiente) con la diferencia tinta-papel de alrededor:
  //  nitida = el salto es casi toda la diferencia; borrosa = el paso se reparte en varios pixeles. Se toma el 10 % de bordes mas
  //  agudos, por separado los verticales y los horizontales (una foto MOVIDA queda borrosa en una sola direccion: cuenta la peor).
  //  Calibrado con fotos reales de facturas (nitidas 0,55-0,77; desenfoque leve 0,45-0,59; desenfocadas 0,35-0,37).
  function medir(g, W, H) {
    const s = caja3(g, W, H), { mx, mn } = maxMin(s, W, H, 3);
    const rx = [], ry = [], m0 = Math.max(4, Math.round(W * 0.03)), m1 = Math.max(4, Math.round(H * 0.03));
    for (let y = m1; y < H - m1; y++) for (let x = m0; x < W - m0; x++) {
      const i = y * W + x, lr = mx[i] - mn[i];
      if (lr < 40) continue;   // sin letra alrededor
      const ax = Math.abs(s[i - W + 1] + 2 * s[i + 1] + s[i + W + 1] - s[i - W - 1] - 2 * s[i - 1] - s[i + W - 1]) / 4;
      const ay = Math.abs(s[i + W - 1] + 2 * s[i + W] + s[i + W + 1] - s[i - W - 1] - 2 * s[i - W] - s[i - W + 1]) / 4;
      if (ax > 2 * ay) rx.push(ax / lr); else if (ay > 2 * ax) ry.push(ay / lr);
    }
    let sum = 0; for (let i = 0; i < g.length; i++) sum += g[i];
    const brillo = g.length ? sum / g.length : 0;
    const muestra = []; for (let i = 0; i < s.length; i += 7) muestra.push(s[i]);
    const papel = pct(muestra, 0.6);
    const agudezaH = pct(rx, 0.9), agudezaV = pct(ry, 0.9), area = Math.max(1, (W - 2 * m0) * (H - 2 * m1));
    return { agudeza: Math.min(agudezaH, agudezaV), agudezaH, agudezaV, bordes: (rx.length + ry.length) / area, brillo, papel };
  }

  // { ok, problemas:[texto] } a partir de medir()
  function revisarImagen(m) {
    const p = [];
    if (!m) return { ok: false, problemas: ['No pude revisar la foto.'] };
    if (m.brillo < LIM.brilloMin) p.push('Está muy oscura: tómala con más luz.');
    else if (m.papel > LIM.papelMax) p.push('Está muy clara (con reflejo o flash): tómala sin que la luz pegue directo.');
    if (m.bordes < LIM.bordesMin) p.push('No se distingue la letra del papel: busca más luz, acércate y enfoca.');
    else if (m.agudeza < LIM.agudezaMin) p.push('Está borrosa o movida: apoya los codos, espera a que el celular enfoque y tómala de nuevo.');
    return { ok: !p.length, problemas: p };
  }

  const ang = (a, b, c) => {   // angulo en b (grados)
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const d = Math.hypot(...v1) * Math.hypot(...v2); if (!d) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180 / Math.PI;
  };
  // esq = 4 esquinas ordenadas [arriba-izq, arriba-der, abajo-der, abajo-izq] en pixeles de la foto
  function revisarEncuadre(esq, W, H) {
    const p = [];
    if (!esq || esq.length !== 4 || !W || !H) return { ok: false, problemas: ['Marca las 4 esquinas de la hoja.'] };
    let area = 0; for (let i = 0; i < 4; i++) { const a = esq[i], b = esq[(i + 1) % 4]; area += a[0] * b[1] - b[0] * a[1]; }
    const frac = Math.abs(area) / 2 / (W * H);
    const cx = esq.reduce((s, q) => s + q[0], 0) / 4, cy = esq.reduce((s, q) => s + q[1], 0) / 4;
    const desv = Math.max(Math.abs(cx - W / 2) / W, Math.abs(cy - H / 2) / H);
    const angs = esq.map((q, i) => ang(esq[(i + 3) % 4], q, esq[(i + 1) % 4]));
    if (frac < LIM.areaMin) p.push('La hoja sale muy pequeña: acércate para que ocupe casi toda la foto.');
    if (desv > LIM.centroMax) p.push('La hoja no está centrada: ponla en el medio de la foto.');
    if (angs.some((a) => a < LIM.anguloMin || a > LIM.anguloMax)) p.push('La hoja está muy de lado: toma la foto de frente, desde arriba.');
    return { ok: !p.length, problemas: p, area: frac, desviacion: desv, angulos: angs };
  }
  // la hoja ya enderezada tiene suficientes pixeles para leer la letra pequeña
  function revisarTamano(w, h) {
    return Math.min(w, h) >= LIM.ladoMin ? { ok: true, problemas: [] } : { ok: false, problemas: ['La foto tiene muy poca resolución: acércate a la hoja (o usa la cámara del celular, no una captura).'] };
  }

  return { LIM, gris, caja3, maxMin, medir, revisarImagen, revisarEncuadre, revisarTamano };
});
