// ============================================================
//  importacion.js  -  IMPORTACION DE BASES (maestros por CSV)  (19/09/2026)
//   Lee un CSV (coma, punto y coma o tabulador; UTF-8 o Excel), reconoce las columnas por su nombre, normaliza y VALIDA cada fila antes de
//   enviarla, y arma la vista previa / plantillas / informe de errores. Lo que ya existe en la base (nuevo, actualiza, igual, duplicado)
//   lo decide la funcion importar_maestro de la base (supabase/importacion.sql) con las mismas reglas de llave.
//  Bases:  proveedores · productos (articulos) · conversiones (unidades_medida) · maximos_minimos · catalogo (catalogo_compras)
//  Logica PURA y determinista (sin red, sin IA). La usa index.html (js/importacion-ui.js) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./conversiones.js'));
  else root.Importacion = factory(root.Conversiones);
})(typeof self !== 'undefined' ? self : this, function (Conv) {
  'use strict';

  const MAX_FILAS = 5000;

  // ---------------------------------------------------------------- las bases y sus columnas
  //  campo = el nombre que entiende la base ; nombre = el de la plantilla ; alias = otros nombres de columna que se reconocen
  const c = (campo, nombre, tipo, extra) => Object.assign({ campo, nombre, tipo: tipo || 'texto', alias: [], req: false }, extra || {});
  const TIPOS = {
    proveedores: {
      titulo: 'Proveedores', tabla: 'proveedores', orden: 1,
      ayuda: 'Una fila por proveedor. La llave es el NIT (sin dígito de verificación): si ya existe se actualiza, no se duplica.',
      columnas: [c('nit', 'nit', 'nit', { req: true, alias: ['nit_proveedor', 'identificacion', 'documento'] }), c('razon_social', 'razon_social', 'texto', { alias: ['razon', 'proveedor', 'nombre'] }),
        c('nombre_comercial', 'nombre_comercial', 'texto', { alias: ['comercial'] }), c('telefono1', 'telefono1', 'texto', { alias: ['telefono', 'tel', 'celular', 'telefono_1'] }),
        c('telefono2', 'telefono2', 'texto', { alias: ['telefono_2'] }), c('correo', 'correo', 'correo', { alias: ['email', 'e_mail', 'correo_electronico'] }),
        c('asesor', 'asesor', 'texto', { alias: ['contacto', 'vendedor'] }), c('id_planilla', 'id_planilla', 'texto', { alias: ['planilla'] })],
      ejemplos: [['900123456', 'DISTRIBUIDORA EJEMPLO S.A.S.', 'DISTRIEJEMPLO', '3001234567', '', 'ventas@ejemplo.co', 'Ana Pérez', '']],
    },
    productos: {
      titulo: 'Productos (artículos)', tabla: 'articulos', orden: 2,
      ayuda: 'Una fila por artículo. La llave es el código: si ya existe se actualiza, no se duplica. La unidad de compra es la presentación (SIXPACK, BOLSAX500G, KILO...).',
      columnas: [c('codigo_barras', 'codigo', 'codigo', { req: true, alias: ['codigo_barras', 'cod_barras', 'codigo_de_barras', 'cod'] }),
        c('articulo_comercial', 'articulo_comercial', 'texto', { alias: ['articulo', 'producto', 'nombre', 'nombre_comercial'] }), c('articulo_hiopos', 'articulo_hiopos', 'texto', { alias: ['nombre_hiopos', 'hiopos'] }),
        c('codigo_referencia', 'codigo_referencia', 'texto', { alias: ['referencia', 'ref'] }), c('subfamilia', 'subfamilia', 'texto', { alias: ['familia', 'categoria'] }),
        c('unimedida_hiopos', 'unidad_hiopos', 'texto', { alias: ['unimedida_hiopos', 'unidad_inventario_hiopos'] }),
        c('unimedida_compra', 'unidad_compra', 'texto', { alias: ['unimedida_compra', 'unidad_de_compra', 'presentacion'] })],
      ejemplos: [['ORD900', 'CERVEZA EJEMPLO', '', '', 'LICORES', '', 'SIXPACK']],
    },
    conversiones: {
      titulo: 'Conversiones (unidad de compra → unidad de inventario)', tabla: 'unidades_medida', orden: 3,
      ayuda: 'Cuánto trae UNA unidad de compra: 1 SIXPACK = 6 uds. La unidad es una medida (g, kg, lb, oz, ml, l, uds o copa), no un empaque. Se guarda en la tabla de conversiones que ya existe.',
      columnas: [c('formato', 'unidad_compra', 'texto', { req: true, alias: ['presentacion', 'formato', 'unimedida_compra', 'unidad_de_compra'] }),
        c('medida', 'cantidad', 'numero', { req: true, alias: ['medida', 'equivale', 'equivalencia', 'contenido', 'trae'] }),
        c('unidad', 'unidad', 'unidad', { req: true, alias: ['unidad_medida', 'unidad_de_medida', 'unidad_inventario', 'unidad_de_inventario', 'equivale_en'] })],
      ejemplos: [['SIXPACK', '6', 'uds']],
    },
    maximos_minimos: {
      titulo: 'Máximos y mínimos', tabla: 'maximos_minimos', orden: 4,
      ayuda: 'Una fila por almacén, artículo y unidad de inventario. Los valores van en la UNIDAD DE INVENTARIO (la web los muestra en la unidad de compra). Una celda vacía no borra lo que ya había.',
      columnas: [c('almacen', 'almacen', 'texto', { req: true, alias: ['sede', 'bodega'] }), c('articulo', 'articulo', 'texto', { req: true, alias: ['producto', 'insumo', 'nombre'] }),
        c('subarticulo', 'unidad_inventario', 'texto', { req: true, alias: ['subarticulo', 'sub_articulo', 'unidad_de_inventario', 'unidad'] }),
        c('minimo', 'minimo', 'numero', { alias: ['min', 'minimum'] }), c('maximo', 'maximo', 'numero', { alias: ['max', 'maximum'] }),
        c('variacion', 'variacion', 'numero'), c('margen', 'margen', 'numero')],
      ejemplos: [['ROCOTO AMSTERDAM', 'CERVEZA EJEMPLO', 'UNIDADES', '6', '12', '', '']],
    },
    catalogo: {
      titulo: 'Catálogo de compras (qué le compro a cada proveedor)', tabla: 'catalogo_compras', orden: 5,
      ayuda: 'Una fila por artículo y proveedor. El proveedor se identifica por su NIT y el artículo por su código; los dos ya deben estar cargados.',
      columnas: [c('codigo_barras', 'codigo', 'codigo', { req: true, alias: ['codigo_barras', 'cod_barras', 'codigo_de_barras', 'cod'] }),
        c('nit_proveedor', 'nit_proveedor', 'nit', { req: true, alias: ['nit', 'proveedor_nit'] }), c('precio_negociado', 'precio', 'numero', { alias: ['precio_negociado'] }),
        c('prioridad', 'prioridad', 'entero'), c('estado', 'estado', 'texto')],
      ejemplos: [['ORD900', '900123456', '15000', '1', 'Aprobado']],
    },
  };
  const ORDEN = Object.keys(TIPOS).sort((a, b) => TIPOS[a].orden - TIPOS[b].orden);

  // ---------------------------------------------------------------- texto
  const sinTildes = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const claveCol = (s) => sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const limpio = (s) => String(s == null ? '' : s).replace(/^﻿/, '').replace(/\s+/g, ' ').trim().replace(/^'(?=\S)/, '');

  // ---------------------------------------------------------------- CSV
  function detectarDelimitador(texto) {
    let enComillas = false, primera = '';
    for (const ch of texto) { if (ch === '"') enComillas = !enComillas; if (!enComillas && (ch === '\n' || ch === '\r')) break; primera += ch; }
    const n = { ';': 0, ',': 0, '\t': 0 };
    let q = false;
    for (const ch of primera) { if (ch === '"') q = !q; else if (!q && ch in n) n[ch]++; }
    const mejor = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
    return n[mejor] > 0 ? mejor : ',';
  }
  // -> { delimitador, registros: [{ n, celdas }] }   n = numero de fila como lo ve Excel (la 1 es el encabezado; las filas en blanco cuentan)
  function parseCSV(texto, delimitador) {
    texto = String(texto == null ? '' : texto).replace(/^﻿/, '');
    const d = delimitador || detectarDelimitador(texto), registros = [];
    let celdas = [], cel = '', q = false, n = 1, hayAlgo = false;
    const cerrarCelda = () => { celdas.push(cel); cel = ''; };
    const cerrarFila = () => {
      cerrarCelda();
      if (celdas.some((x) => x.trim() !== '')) registros.push({ n, celdas });
      celdas = []; n++; hayAlgo = false;
    };
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (q) {
        if (ch === '"') { if (texto[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += ch;
        continue;
      }
      if (ch === '"' && cel === '') { q = true; hayAlgo = true; }
      else if (ch === d) { cerrarCelda(); hayAlgo = true; }
      else if (ch === '\r') { if (texto[i + 1] === '\n') i++; cerrarFila(); }
      else if (ch === '\n') cerrarFila();
      else { cel += ch; hayAlgo = true; }
    }
    if (hayAlgo || cel !== '' || celdas.length) cerrarFila();
    return { delimitador: d, registros };
  }
  // el archivo como llega del navegador: UTF-8 y, si no lo es (Excel en español), Windows-1252
  function decodificar(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }

  // ---------------------------------------------------------------- valores
  // "1,5" "1.5" "1.234,5" "1,234.5" "1.500" (miles) "0.500" (decimal) -> numero ; null si no es un numero
  function numero(t) {
    let s = String(t == null ? '' : t).trim().replace(/\s+/g, '').replace(/^\$/, '');
    if (s === '') return { vacio: true };
    if (!/^-?[0-9.,]+$/.test(s)) return { error: true };
    const neg = s[0] === '-'; if (neg) s = s.slice(1);
    let aviso = null, v;
    const puntos = (s.match(/\./g) || []).length, comas = (s.match(/,/g) || []).length;
    if (puntos && comas) { const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','; const mil = dec === '.' ? ',' : '.'; v = s.split(mil).join('').replace(dec, '.'); }
    else if (comas > 1 || puntos > 1) { v = s.replace(/[.,]/g, ''); }
    else if (comas === 1) v = s.replace(',', '.');
    else if (puntos === 1 && /^[1-9][0-9]{0,2}\.[0-9]{3}$/.test(s)) { v = s.replace('.', ''); aviso = `"${s}" se leyó como ${v} (el punto como separador de miles)`; }
    else v = s;
    const x = Number(v);
    return Number.isFinite(x) ? { valor: neg ? -x : x, aviso } : { error: true };
  }
  const REG_CODIGO = /^[A-Za-z0-9._-]+$/, REG_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // normaliza UNA celda segun el tipo de la columna. -> { valor, error?, aviso? }   (valor vacio = null: "no viene")
  function normalizar(col, crudo) {
    const t = limpio(crudo);
    if (t === '') return { valor: null };
    switch (col.tipo) {
      case 'nit': {
        const m = /^([\d.\s]+)-\s*(\d)$/.exec(t);                                                   // 900.123.456-7 -> sin el digito de verificacion
        const dig = (m ? m[1] : t).replace(/\D/g, '');
        if (!dig) return { valor: null, error: 'el NIT no tiene dígitos' };
        return { valor: dig, aviso: m ? 'se quitó el dígito de verificación del NIT' : null };
      }
      case 'codigo': return { valor: /^[0-9]+\.0+$/.test(t) ? t.split('.')[0] : t };                // Excel: 1728.0 -> 1728
      case 'numero': { const r = numero(t); return r.error ? { valor: null, error: `"${t}" no es un número` } : { valor: r.valor, aviso: r.aviso }; }
      case 'entero': { const r = numero(t); return r.error || !Number.isInteger(r.valor) ? { valor: null, error: `"${t}" no es un número entero` } : { valor: r.valor, aviso: r.aviso }; }
      case 'correo': return { valor: t.toLowerCase() };
      case 'unidad': return { valor: t.toLowerCase() };
      default: return { valor: t };
    }
  }

  // ---------------------------------------------------------------- llaves (para detectar repetidas dentro del archivo)
  const llaveDe = {
    proveedores: (d) => d.nit, productos: (d) => String(d.codigo_barras || '').toUpperCase(), conversiones: (d) => Conv.claveFormato(d.formato),
    maximos_minimos: (d) => [Conv.claveNombre(d.almacen), Conv.claveNombre(d.articulo), Conv.norm(d.subarticulo)].join('|'),
    catalogo: (d) => String(d.codigo_barras || '').toUpperCase() + '|' + d.nit_proveedor,
  };
  const UNIDADES_OK = new Set(['copa']);
  function unidadMedible(u) {
    if (UNIDADES_OK.has(u)) return { ok: true };
    const ind = Conv.indiceBase(), canon = ind.get(Conv.norm(u));
    if (!canon) return { ok: false, motivo: `la unidad "${u}" no se reconoce (usa g, kg, lb, oz, ml, l, uds o copa)` };
    if (ind.catalogo[canon].familia === 'empaque') return { ok: false, motivo: `"${u}" es un empaque, no una medida: di cuántas unidades, gramos o mililitros trae` };
    return { ok: true };
  }

  // reglas por base (las mismas que aplica la base de datos; aqui se avisa antes de enviar)
  const reglas = {
    proveedores(d, err) {
      if (d.nit && (d.nit.length < 5 || d.nit.length > 15)) err.push('el NIT no parece válido (debe tener entre 5 y 15 dígitos)');
      if (!d.razon_social && !d.nombre_comercial) err.push('falta la razón social');
      if (d.correo && !REG_CORREO.test(d.correo)) err.push('el correo no es válido');
    },
    productos(d, err) {
      if (d.codigo_barras && !REG_CODIGO.test(d.codigo_barras)) err.push('el código solo puede tener letras, números, punto, guion y guion bajo');
      if (!d.articulo_comercial && !d.articulo_hiopos) err.push('falta el nombre del artículo');
    },
    conversiones(d, err) {
      if (d.medida != null && d.medida <= 0) err.push('la cantidad debe ser mayor que 0');
      if (d.medida != null && d.medida > 10000000) err.push('la cantidad es absurda (más de 10 millones)');
      if (d.unidad) { const u = unidadMedible(d.unidad); if (!u.ok) err.push(u.motivo); }
    },
    maximos_minimos(d, err) {
      if (d.minimo == null && d.maximo == null) err.push('no trae ni mínimo ni máximo');
      else if ((d.minimo != null && d.minimo < 0) || (d.maximo != null && d.maximo < 0)) err.push('el mínimo y el máximo no pueden ser negativos');
      else if (d.minimo != null && d.maximo != null && d.minimo > d.maximo) err.push(`el mínimo (${d.minimo}) es mayor que el máximo (${d.maximo})`);
    },
    catalogo(d, err) {
      if (d.nit_proveedor && (d.nit_proveedor.length < 5 || d.nit_proveedor.length > 15)) err.push('el NIT del proveedor no parece válido');
      if (d.precio_negociado != null && d.precio_negociado < 0) err.push('el precio no puede ser negativo');
      if (d.prioridad != null && d.prioridad < 1) err.push('la prioridad debe ser 1 o más');
    },
  };

  // ---------------------------------------------------------------- LEER Y VALIDAR
  // -> { ok, errores (del archivo), delimitador, cabeceras, columnas: [{campo, cabecera, indice}], ignoradas, filas: [{ n, datos, crudo, errores, avisos }] }
  function leer(texto, tipoId) {
    const T = TIPOS[tipoId];
    if (!T) return { ok: false, errores: ['tipo de base desconocido'], filas: [], cabeceras: [], columnas: [], ignoradas: [] };
    const { delimitador, registros } = parseCSV(texto);
    const salida = { ok: false, errores: [], delimitador, cabeceras: [], columnas: [], ignoradas: [], filas: [], tipo: tipoId };
    if (!registros.length) { salida.errores.push('el archivo está vacío'); return salida; }
    const enc = registros[0], cab = enc.celdas.map(limpio);
    salida.cabeceras = cab;
    // cada columna de la base busca su encabezado (por su nombre o por un alias); una encabezado sirve a una sola columna
    const usadas = new Set(), mapa = {};
    for (const col of T.columnas) {
      const nombres = [claveCol(col.nombre), claveCol(col.campo)].concat(col.alias.map(claveCol));
      const i = cab.findIndex((h, k) => !usadas.has(k) && h && nombres.includes(claveCol(h)));
      if (i >= 0) { usadas.add(i); mapa[col.campo] = i; salida.columnas.push({ campo: col.campo, cabecera: cab[i], indice: i }); }
    }
    salida.ignoradas = cab.filter((h, k) => h && !usadas.has(k));
    const faltan = T.columnas.filter((col) => col.req && mapa[col.campo] == null);
    if (faltan.length) salida.errores.push('faltan columnas obligatorias: ' + faltan.map((col) => col.nombre).join(', ') + ' (las encontradas: ' + (cab.filter(Boolean).join(', ') || 'ninguna') + ')');
    const cuerpo = registros.slice(1);
    if (!cuerpo.length && !faltan.length) salida.errores.push('el archivo solo tiene el encabezado, no hay filas');
    if (cuerpo.length > MAX_FILAS) salida.errores.push(`el archivo tiene ${cuerpo.length} filas y el máximo es ${MAX_FILAS}: divídelo en partes`);
    if (salida.errores.length) return salida;

    const vistos = new Map();
    for (const reg of cuerpo) {
      const err = [], avisos = [], datos = {};
      for (const col of T.columnas) {
        if (mapa[col.campo] == null) continue;
        const r = normalizar(col, reg.celdas[mapa[col.campo]]);
        if (r.error) err.push(`${col.nombre}: ${r.error}`);
        if (r.aviso) avisos.push(r.aviso);
        datos[col.campo] = r.valor;
      }
      for (const col of T.columnas) if (col.req && datos[col.campo] == null && !err.some((e) => e.startsWith(col.nombre + ':'))) err.push('falta ' + col.nombre);
      if (!err.length) reglas[tipoId](datos, err);
      if (!err.length) {
        const k = llaveDe[tipoId](datos);
        if (vistos.has(k)) err.push(`repetida en el archivo (misma que la fila ${vistos.get(k)})`); else vistos.set(k, reg.n);
      }
      salida.filas.push({ n: reg.n, datos, crudo: reg.celdas, errores: err, avisos });
    }
    salida.ok = true;
    return salida;
  }

  // ---------------------------------------------------------------- HACIA Y DESDE LA BASE
  // Las filas sin error, tal como las recibe importar_maestro (los vacios no se envian: una celda vacia no borra nada)
  function aServidor(leido) {
    return leido.filas.filter((f) => !f.errores.length).map((f) => {
      const o = { n: f.n };
      for (const k of Object.keys(f.datos)) if (f.datos[k] != null) o[k] = f.datos[k];
      return o;
    });
  }
  // Junta lo que vio el navegador con lo que respondio la base. respuesta = null si la base no respondio.
  function combinar(leido, respuesta) {
    const porN = new Map(((respuesta && respuesta.filas) || []).map((f) => [f.n, f]));
    return leido.filas.map((f) => {
      if (f.errores.length) return { n: f.n, estado: 'error', cambios: [], errores: f.errores.slice(), avisos: f.avisos.slice(), datos: f.datos, crudo: f.crudo };
      const s = porN.get(f.n);
      if (!s) return { n: f.n, estado: 'sin_verificar', cambios: [], errores: [], avisos: f.avisos.slice(), datos: f.datos, crudo: f.crudo };
      return { n: f.n, estado: s.estado, cambios: s.cambios || [], errores: (s.errores || []).slice(), avisos: f.avisos.concat(s.avisos || []), datos: f.datos, crudo: f.crudo };
    });
  }
  function resumen(filas) {
    const r = { total: filas.length, nuevos: 0, actualizados: 0, iguales: 0, errores: 0, sinVerificar: 0, conAvisos: 0 };
    for (const f of filas) {
      if (f.estado === 'nuevo') r.nuevos++; else if (f.estado === 'actualiza') r.actualizados++; else if (f.estado === 'igual') r.iguales++; else if (f.estado === 'error') r.errores++; else r.sinVerificar++;
      if (f.avisos.length) r.conAvisos++;
    }
    r.aplicables = r.nuevos + r.actualizados;
    return r;
  }
  const ETIQUETA = { nuevo: 'Nueva', actualiza: 'Actualiza', igual: 'Sin cambios', error: 'Error', sin_verificar: 'Sin verificar' };

  // ---------------------------------------------------------------- ARCHIVOS PARA DESCARGAR
  const celdaCSV = (v, d) => { const s = String(v == null ? '' : v); return new RegExp('["\\n\\r' + (d === '\t' ? '\\t' : d) + ']').test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lineaCSV = (arr, d) => arr.map((v) => celdaCSV(v, d)).join(d);
  // BOM + ";" para que Excel en español lo abra en columnas. El lector reconoce ";" solo.
  const conBOM = (lineas) => '﻿' + lineas.join('\r\n') + '\r\n';
  function plantilla(tipoId) {
    const T = TIPOS[tipoId]; if (!T) return '';
    return conBOM([lineaCSV(T.columnas.map((col) => col.nombre), ';')].concat(T.ejemplos.map((e) => lineaCSV(e, ';'))));
  }
  // Conversiones que faltan (de Conversiones.conversionesFaltantes): unidad_compra con cantidad y unidad vacias para llenar, y notas que el lector ignora
  function plantillaFaltantes(faltantes) {
    const lin = [lineaCSV(['unidad_compra', 'cantidad', 'unidad', 'nota_unidad_de_inventario', 'nota_articulos', 'nota_por_que'], ';')];
    const vistos = new Set();
    for (const f of faltantes || []) {
      const k = Conv.claveFormato(f.presentacion); if (vistos.has(k)) continue; vistos.add(k);        // una presentacion, una fila (aunque falte para varias unidades de inventario)
      const inv = (faltantes || []).filter((x) => Conv.claveFormato(x.presentacion) === k).map((x) => x.unidadInventario).join(' / ');
      const n = (faltantes || []).filter((x) => Conv.claveFormato(x.presentacion) === k).reduce((s, x) => s + x.articulos, 0);
      lin.push(lineaCSV([f.presentacion, '', '', inv, n, f.motivo], ';'));
    }
    return conBOM(lin);
  }
  // Informe de las filas con error: fila, problema y lo que venia en el archivo, para corregirlo y volver a subir
  function informeErrores(leido, filas, delim) {
    const d = delim || ';';
    const lin = [lineaCSV(['fila', 'estado', 'problema'].concat(leido.cabeceras), d)];
    for (const f of filas.filter((x) => x.estado === 'error')) lin.push(lineaCSV([f.n, 'error', f.errores.join(' | ')].concat(f.crudo), d));
    return conBOM(lin);
  }

  return { MAX_FILAS, TIPOS, ORDEN, ETIQUETA, claveCol, detectarDelimitador, parseCSV, decodificar, numero, normalizar, leer, aServidor, combinar, resumen, plantilla, plantillaFaltantes, informeErrores };
});
