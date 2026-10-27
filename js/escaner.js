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

  // «escaneado» (27/10/2026, rehecho: «queda muy mal escaneado»: texto gris claro, borroso y lavado). Pasos:
  //  1. enfoque suave (mascara de enfoque) para recuperar letra pequeña de una foto un poco movida;
  //  2. FONDO = color del papel: por bloques se toma el percentil 90 (lo mas claro = papel, no la tinta). Antes era el PROMEDIO
  //     y en las zonas con mucho texto (la tabla de la factura) el fondo salia oscuro y la letra quedaba lavada;
  //  3. cada pixel se divide por su fondo (quita la sombra del celular) y se ESTIRA el contraste: tinta -> negro, papel -> blanco.
  // modo 'bn' = blanco y negro (texto negro sobre blanco); 'color' = color con fondo blanco y colores reforzados.
  function fondoPapel(gris, W, H) {
    const B = Math.max(16, Math.round(Math.max(W, H) / 60)), bw = Math.ceil(W / B), bh = Math.ceil(H / B), blo = new Float32Array(bw * bh);
    const tmp = new Float32Array(B * B);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      for (let y = by * B; y < Math.min(H, by * B + B); y += 2) for (let x = bx * B; x < Math.min(W, bx * B + B); x += 2) tmp[n++] = gris[y * W + x];
      const v = tmp.subarray(0, n).sort(); blo[by * bw + bx] = v[Math.min(n - 1, Math.floor(n * 0.9))];
    }
    // bloques casi todo tinta (logo, sello): se toma el mas claro de los vecinos; luego se suaviza
    const dil = new Float32Array(bw * bh), suave = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) m = Math.max(m, blo[yy * bw + xx]); }
      dil[y * bw + x] = m;
    }
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += dil[yy * bw + xx]; n++; } }
      suave[y * bw + x] = s / n;
    }
    // valor en cada pixel: interpolacion bilineal entre centros de bloque
    return (x, y) => {
      const fx = Math.max(0, Math.min(bw - 1.001, x / B - 0.5)), fy = Math.max(0, Math.min(bh - 1.001, y / B - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      return (suave[y0 * bw + x0] * (1 - ax) + suave[y0 * bw + x1] * ax) * (1 - ay) + (suave[y1 * bw + x0] * (1 - ax) + suave[y1 * bw + x1] * ax) * ay;
    };
  }
  function mejorar(img, modo) {
    const { width: W, height: H, data } = img, n = W * H, g0 = new Float32Array(n);
    for (let i = 0; i < n; i++) g0[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    // 1. enfoque: g = g0 + 0.6 * (g0 - promedio 3x3)
    const gris = new Float32Array(n), K = 0.6;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; s += g0[yy * W + xx]; c++; } }
      const p = y * W + x; gris[p] = g0[p] + K * (g0[p] - s / c);
    }
    const fondo = fondoPapel(g0, W, H);
    const LO = 0.45, HI = 0.84;  // relacion pixel/papel: <= LO es tinta plena (negro), >= HI es papel (blanco)
    const curva = (v) => { const t = Math.max(0, Math.min(1, (v - LO) / (HI - LO))); return Math.pow(t, 1.2); };
    const out = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x, f = Math.max(40, fondo(x, y)), i = p * 4;
        if (modo === 'color') {
          // cada color dividido por el papel (sin sombra) y con el mismo estirado: papel blanco, tinta y sellos con su color pero mas fuertes
          const realce = gris[p] / Math.max(1, g0[p]);
          for (let k = 0; k < 3; k++) out[i + k] = Math.round(255 * curva((data[i + k] * realce) / f));
        } else {
          out[i] = out[i + 1] = out[i + 2] = Math.round(255 * curva(gris[p] / f));
        }
        out[i + 3] = 255;
      }
    }
    return { data: out, width: W, height: H };
  }

  return { homografia, aplicar, ordenar, tamano, valido, esquinasIniciales, enderezar, mejorar, fondoPapel };
});
