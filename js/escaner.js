// ============================================================
//  escaner.js  -  ESCANEAR la foto de una factura / cuenta de cobro (19/10/2026, pedido del usuario)
// ============================================================
// Logica pura (sin pantalla): con las 4 esquinas de la hoja que marca la sede se endereza la foto (perspectiva) y se deja
// como si se hubiera pasado por un escaner (blanco y negro con buen contraste, o color mejorado). Sin IA y sin servicios
// externos: todo se calcula en el celular / PC. La pantalla esta en js/escaner-ui.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Escaner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // resuelve A x = b (8x8) por Gauss con pivoteo
  function resolver(A, b) {
    const n = b.length, M = A.map((f, i) => f.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let f = c + 1; f < n; f++) if (Math.abs(M[f][c]) > Math.abs(M[p][c])) p = f;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let f = 0; f < n; f++) {
        if (f === c) continue;
        const k = M[f][c] / M[c][c];
        for (let j = c; j <= n; j++) M[f][j] -= k * M[c][j];
      }
    }
    return M.map((f, i) => f[n] / f[i]);
  }
  // homografia que lleva los 4 puntos «de» a los 4 puntos «a» -> [h0..h7] (h8 = 1)
  function homografia(de, a) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = de[i], [u, v] = a[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    return resolver(A, b);
  }
  function aplicar(h, x, y) {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  }
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  // ordena 4 puntos como [arriba-izq, arriba-der, abajo-der, abajo-izq]
  function ordenar(pts) {
    const s = pts.map((p) => p[0] + p[1]), d = pts.map((p) => p[0] - p[1]);
    const ai = pts[s.indexOf(Math.min(...s))], bd = pts[s.indexOf(Math.max(...s))];
    const ad = pts[d.indexOf(Math.max(...d))], bi = pts[d.indexOf(Math.min(...d))];
    return [ai, ad, bd, bi];
  }
  // tamaño de la hoja enderezada (proporcion de los lados marcados), con el lado mayor <= maxLado
  function tamano(esq, maxLado) {
    const [ai, ad, bd, bi] = esq;
    let w = Math.max(dist(ai, ad), dist(bi, bd)), h = Math.max(dist(ai, bi), dist(ad, bd));
    const k = Math.min(1, (maxLado || 1600) / Math.max(w, h));
    return { w: Math.max(20, Math.round(w * k)), h: Math.max(20, Math.round(h * k)) };
  }
  // ¿las esquinas forman una hoja valida? (convexa y no demasiado chica)
  function valido(esq, anchoImg, altoImg) {
    if (!esq || esq.length !== 4) return false;
    let signo = 0;
    for (let i = 0; i < 4; i++) {
      const p = esq[i], q = esq[(i + 1) % 4], r = esq[(i + 2) % 4];
      const z = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
      if (Math.abs(z) < 1e-6) return false;
      if (!signo) signo = Math.sign(z); else if (Math.sign(z) !== signo) return false;
    }
    let area = 0; for (let i = 0; i < 4; i++) { const p = esq[i], q = esq[(i + 1) % 4]; area += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(area) / 2 >= 0.04 * anchoImg * altoImg;
  }
  // esquinas de partida: un poco hacia adentro del borde de la foto
  function esquinasIniciales(ancho, alto, margen) {
    const m = margen == null ? 0.06 : margen, x0 = ancho * m, y0 = alto * m, x1 = ancho * (1 - m), y1 = alto * (1 - m);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  // endereza: src = { data (RGBA), width, height }, esq = 4 esquinas en pixeles de src -> { data, width, height }
  function enderezar(src, esq, maxLado) {
    const o = ordenar(esq), t = tamano(o, maxLado);
    const h = homografia([[0, 0], [t.w - 1, 0], [t.w - 1, t.h - 1], [0, t.h - 1]], o);   // salida -> foto (muestreo inverso)
    if (!h) return null;
    const out = new Uint8ClampedArray(t.w * t.h * 4), W = src.width, H = src.height, d = src.data;
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const [sx, sy] = aplicar(h, x, y), i = (y * t.w + x) * 4;
        const x0 = Math.max(0, Math.min(W - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(H - 1, Math.floor(sy)));
        const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
        const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, e = (y1 * W + x1) * 4;
        for (let k = 0; k < 3; k++) out[i + k] = (d[a + k] * (1 - fx) + d[b + k] * fx) * (1 - fy) + (d[c + k] * (1 - fx) + d[e + k] * fx) * fy;
        out[i + 3] = 255;
      }
    }
    return { data: out, width: t.w, height: t.h };
  }

  // «escaneado»: corrige la luz dispareja (sombra del celular) dividiendo por el fondo (promedio local grande) y estira el
  // contraste. modo 'bn' = blanco y negro (texto negro sobre blanco); 'color' = color con fondo blanqueado.
  function mejorar(img, modo) {
    const { width: W, height: H, data } = img, n = W * H, gris = new Float32Array(n);
    for (let i = 0; i < n; i++) gris[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    // fondo = promedio en una ventana grande (imagen integral)
    const r = Math.max(8, Math.round(Math.max(W, H) / 24)), I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let fila = 0; for (let x = 0; x < W; x++) { fila += gris[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + fila; } }
    const fondo = (x, y) => {
      const xa = Math.max(0, x - r), ya = Math.max(0, y - r), xb = Math.min(W, x + r + 1), yb = Math.min(H, y + r + 1);
      return (I[yb * (W + 1) + xb] - I[ya * (W + 1) + xb] - I[yb * (W + 1) + xa] + I[ya * (W + 1) + xa]) / ((xb - xa) * (yb - ya));
    };
    const out = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x, f = Math.max(30, fondo(x, y) * 1.02), i = p * 4;
        if (modo === 'color') {
          for (let k = 0; k < 3; k++) out[i + k] = Math.min(255, (data[i + k] / f) * 255);
        } else {
          const v = Math.min(1, gris[p] / f);                 // 1 = papel, < 1 = tinta
          out[i] = out[i + 1] = out[i + 2] = v > 0.86 ? 255 : Math.max(0, Math.round(255 * Math.pow(v / 0.86, 2.2)));
        }
        out[i + 3] = 255;
      }
    }
    return { data: out, width: W, height: H };
  }

  return { homografia, aplicar, ordenar, tamano, valido, esquinasIniciales, enderezar, mejorar };
});
