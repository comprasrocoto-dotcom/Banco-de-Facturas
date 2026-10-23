// ============================================================
//  revisar-amarre.js  -  ¿ESTA FACTURA ES DE ESTE PEDIDO?  (23/10/2026, pedido del usuario)
// ============================================================
// «Que la pagina, antes de amarrar la factura, revise si corresponde al pedido: estan amarrando facturas que no son.»
// Antes de amarrar se compara (sin IA, solo texto y fechas):
//   1. PRODUCTOS: cuantos articulos del pedido aparecen escritos en el PDF de la factura (por palabras clave del nombre).
//   2. FECHA: una factura emitida varios dias ANTES del pedido no puede ser de ese pedido.
//   3. SEDE: la sede de la factura (si la tiene) contra la del pedido.
//   4. OTRO PEDIDO MEJOR: otro pedido pendiente del mismo proveedor cuyos productos SI estan en la factura.
// Logica pura (sin red): la usa index.html y se prueba con node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RevisarAmarre = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // palabras que no sirven para reconocer un producto (unidades, presentaciones, conectores)
  const NO_SIRVEN = new Set(('KILO KILOS KG KGS GR GRS GRAMO GRAMOS LIBRA LIBRAS LB LBS UND UNDS UNID UNIDAD UNIDADES UN ML LT LTS LITRO LITROS ' +
    'PAQ PAQUETE PAQUETES CAJA CAJAS BOLSA BOLSAS BULTO BULTOS FRASCO FRASCOS TARRO GALON GALONES ATADO ATADOS DOCENA ' +
    'BAR COCINA PARA CON SIN DEL LAS LOS UNA UNO POR TIPO MARCA REF REFERENCIA PRESENTACION ' +
    'FRESCO FRESCA FRESCOS FRESCAS GRANDE GRANDES PEQUENO MEDIANO EXTRA ESPECIAL NATURAL BLANCO BLANCA ROJO ROJA VERDE ' +
    'IMPORTADO NACIONAL ENTERO ENTERA').split(' '));

  function plano(t) {
    return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  }
  // nombre del articulo -> palabras clave (>= 4 letras, sin numeros ni unidades)
  function claves(nombre) {
    const out = [];
    for (const w of plano(nombre).split(/[^A-Z0-9]+/)) {
      if (w.length < 4 || /\d/.test(w) || NO_SIRVEN.has(w)) continue;
      if (!out.includes(w)) out.push(w);
    }
    return out;
  }
  // texto del PDF -> conjunto de "raices" (primeras 5 letras) de sus palabras: tolera plurales y cortes ("TOMATES" ~ "TOMATE")
  function raicesTexto(texto) {
    const s = new Set();
    for (const w of plano(texto).split(/[^A-Z0-9]+/)) if (w.length >= 4 && !/^\d+$/.test(w)) s.add(w.slice(0, 5));
    return s;
  }
  // ¿la linea del pedido aparece en la factura? Basta UNA palabra clave del nombre; con 3+ claves se piden 2 (evita "SALSA" sola)
  function lineaEnTexto(nombre, raices) {
    const k = claves(nombre);
    if (!k.length) return null;   // nombre sin palabras utiles: no cuenta ni a favor ni en contra
    const n = k.filter((w) => raices.has(w.slice(0, 5))).length;
    return n >= (k.length >= 3 ? 2 : 1);
  }
  // lineas: [{insumo}] ; texto: texto del PDF  ->  { contadas, encontradas, faltan: [nombres], proporcion }
  function compararProductos(lineas, texto) {
    const r = raicesTexto(texto);
    let contadas = 0, encontradas = 0; const faltan = [];
    for (const l of lineas || []) {
      const nombre = l && (l.insumo || l.articulo || l.nombre);
      const ok = lineaEnTexto(nombre, r);
      if (ok === null) continue;
      contadas++;
      if (ok) encontradas++; else faltan.push(String(nombre));
    }
    return { contadas, encontradas, faltan, proporcion: contadas ? encontradas / contadas : null };
  }

  const DIA = 86400000;
  const fechaMs = (f) => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };

  // o = { factura:{fecha_emision, sede_id}, pedido:{numero, fecha, sede_id}, lineas:[...], texto: string|null,
  //       otros: [{pedido, lineas}] (pendientes del mismo proveedor), nombreSede:(id)=>texto }
  // -> { nivel: 'ok'|'aviso'|'grave', motivos:[texto], productos, mejores:[{numero, encontradas, contadas}] }
  function revisar(o) {
    o = o || {};
    const f = o.factura || {}, p = o.pedido || {}, motivos = [];
    let nivel = 'ok';
    const sube = (n) => { if (n === 'grave' || (n === 'aviso' && nivel === 'ok')) nivel = n; };
    let productos = null;
    if (o.texto && String(o.texto).trim().length > 40) {
      productos = compararProductos(o.lineas, o.texto);
      if (productos.contadas) {
        if (productos.encontradas === 0) { sube('grave'); motivos.push(`Ninguno de los ${productos.contadas} producto(s) del pedido aparece en la factura (pedido: ${productos.faltan.slice(0, 4).join(', ')}${productos.faltan.length > 4 ? '…' : ''}).`); }
        else if (productos.proporcion < 0.5) { sube('aviso'); motivos.push(`Solo ${productos.encontradas} de ${productos.contadas} producto(s) del pedido aparecen en la factura. No aparecen: ${productos.faltan.slice(0, 4).join(', ')}${productos.faltan.length > 4 ? '…' : ''}.`); }
      }
    }
    const fe = fechaMs(f.fecha_emision), fp = fechaMs(p.fecha);
    if (fe != null && fp != null) {
      const dias = Math.round((fp - fe) / DIA);
      if (dias > 10) { sube('grave'); motivos.push(`La factura es del ${String(f.fecha_emision).slice(0, 10)}, ${dias} días ANTES del pedido (${String(p.fecha).slice(0, 10)}): no puede ser de ese pedido.`); }
      else if (dias > 3) { sube('aviso'); motivos.push(`La factura es del ${String(f.fecha_emision).slice(0, 10)}, ${dias} días antes del pedido (${String(p.fecha).slice(0, 10)}).`); }
    }
    if (f.sede_id && p.sede_id && Number(f.sede_id) !== Number(p.sede_id)) {
      sube('aviso');
      const ns = o.nombreSede || ((id) => 'sede ' + id);
      motivos.push(`La factura está en ${ns(f.sede_id)} y el pedido es de ${ns(p.sede_id)}.`);
    }
    // otro pedido pendiente del mismo proveedor que cuadra mejor con la factura
    const mejores = [];
    if (o.texto && productos && productos.contadas) {
      for (const x of o.otros || []) {
        const c = compararProductos(x.lineas, o.texto);
        if (!c.contadas || c.proporcion == null) continue;
        if (c.proporcion >= 0.5 && c.proporcion > (productos.proporcion || 0) + 0.25) mejores.push({ numero: x.pedido && x.pedido.numero, id: x.pedido && x.pedido.id, encontradas: c.encontradas, contadas: c.contadas, fecha: x.pedido && x.pedido.fecha });
      }
      mejores.sort((a, b) => b.encontradas / b.contadas - a.encontradas / a.contadas);
      if (mejores.length && nivel !== 'ok') motivos.push('Esta factura cuadra mejor con: ' + mejores.slice(0, 3).map((m) => `${m.numero} (${m.encontradas} de ${m.contadas} productos)`).join(', ') + '.');
    }
    return { nivel, motivos, productos, mejores };
  }

  // texto del aviso para la persona
  function texto(r, numFactura, numPedido) {
    return (r.nivel === 'grave' ? '⛔ ' : '⚠️ ') + `Parece que la factura ${numFactura || ''} NO es del pedido ${numPedido || ''}:\n\n` + r.motivos.map((m) => '• ' + m).join('\n');
  }

  return { plano, claves, raicesTexto, lineaEnTexto, compararProductos, revisar, texto };
});
