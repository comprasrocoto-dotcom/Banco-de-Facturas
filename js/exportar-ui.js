// ============================================================
//  exportar-ui.js  -  BOTONES "⬇ Excel" y "⬇ CSV" EN TODOS LOS MODULOS  (26/09/2026)
//  Cada pantalla guarda en EXPORTAR.actual[clave] la lista que esta mostrando (ya con filtros y busqueda) y aqui se define que columnas lleva cada una.
//  Usa las globales de index.html: $, SB, sedes, perfil, adminMarcas, adminVinc, adminCat, USR, BancoUtils, XLSX. Logica pura: js/exportar.js.
// ============================================================
const EXPORTAR = { actual: {}, defs: {} };

// ---- utilidades de nombres (sede / marca) desde las sedes ya cargadas
const expSede = (id) => { const s = (typeof sedes !== 'undefined' ? sedes : []).find((x) => x.id === id); return s ? (s.marcas && s.marcas.nombre ? s.marcas.nombre + ' · ' : '') + s.nombre : null; };
const expMarca = (id) => { const s = (typeof sedes !== 'undefined' ? sedes : []).find((x) => x.marca_id === id); return s && s.marcas ? s.marcas.nombre : null; };
const expNum = (x) => Exportar.num(x);
const ESTADO_FACTURA_TXT = { pool: 'Sin asignar', asignada: 'Asignada (sin sellar)', sellada: 'Sellada y aprobada', pagada: 'En pagos', rechazada: 'Rechazada' };

// ---- que columnas lleva cada lista
EXPORTAR.defs.facturas = { nombre: 'facturas', hoja: 'Facturas', columnas: [
  { t: 'Documento', v: (f) => f.documento || ((f.prefijo || '') + (f.folio || '')) || f.numero }, { t: 'Tipo', v: (f) => f.tipo }, { t: 'Categoría', v: (f) => f.categoria },
  { t: 'Proveedor', v: (f) => f.emisor }, { t: 'NIT proveedor', v: (f) => f.nit_emisor }, { t: 'Fecha emisión', v: (f) => f.fecha_emision },
  { t: 'Total', v: (f) => expNum(f.total) }, { t: 'IVA', v: (f) => expNum(f.iva) }, { t: 'Estado', v: (f) => ESTADO_FACTURA_TXT[f.estado] || f.estado },
  { t: 'Marca', v: (f) => expMarca(f.marca_id) }, { t: 'Sede', v: (f) => expSede(f.sede_id) }, { t: 'N° ingreso ERP', v: (f) => f.num_ingreso }, { t: 'Fecha ingreso', v: (f) => (f.fecha_ingreso && f.fecha_ingreso !== 'null' ? f.fecha_ingreso : null) },
  { t: 'Recibido por', v: (f) => f.recibido_por }, { t: 'Pedido amarrado', v: (f) => f.pedido_num }, { t: 'CUFE', v: (f) => f.cufe } ] };

EXPORTAR.defs.pedidos = { nombre: 'pedidos', hoja: 'Pedidos', columnas: [
  { t: 'N° pedido', v: (p) => p.numero }, { t: 'Fecha', v: (p) => p.fecha }, { t: 'Fecha entrega', v: (p) => p.fecha_entrega }, { t: 'Marca', v: (p) => expMarca(p.marca_id) }, { t: 'Sede', v: (p) => p.sede_texto || expSede(p.sede_id) },
  { t: 'Proveedor', v: (p) => p.proveedor_texto || p.proveedor }, { t: 'NIT proveedor', v: (p) => p.nit_proveedor }, { t: 'Tipo', v: (p) => p.tipo }, { t: 'Estado', v: (p) => (p.estado === 'facturado' ? 'Facturado' : p.estado === 'pendiente' ? 'Pendiente' : p.estado) },
  { t: 'N° factura', v: (p) => p.numero_factura }, { t: 'Pedido ERP', v: (p) => p.pedido_erp }, { t: 'Forma de pago', v: (p) => p.forma_pago }, { t: 'Total', v: (p) => expNum(p.total) },
  { t: 'Responsable', v: (p) => p.responsable }, { t: 'Observación', v: (p) => p.observacion || p.observacion_pedido }, { t: 'N° nota crédito', v: (p) => p.numero_nota_credito }, { t: 'Creado', v: (p) => (p.created_at ? String(p.created_at).slice(0, 16).replace('T', ' ') : null) } ] };

// Detalle de los pedidos que se ven: UNA FILA POR ARTICULO (se leen las lineas de esos pedidos de a tandas)
EXPORTAR.defs.pedidos_detalle = { nombre: 'pedidos_detalle', hoja: 'Detalle de pedidos', columnas: [
  { t: 'N° pedido', v: (r) => r.p.numero }, { t: 'Fecha', v: (r) => r.p.fecha }, { t: 'Sede', v: (r) => r.p.sede_texto || expSede(r.p.sede_id) }, { t: 'Proveedor', v: (r) => r.p.proveedor_texto || r.p.proveedor },
  { t: 'Estado', v: (r) => r.p.estado }, { t: 'Código', v: (r) => r.l.codigo }, { t: 'Artículo', v: (r) => r.l.insumo }, { t: 'Cantidad', v: (r) => expNum(r.l.cantidad) }, { t: 'Unidad', v: (r) => r.l.unidad }, { t: 'Subfamilia', v: (r) => r.l.subfamilia } ],
  datos: async () => {
    const ps = EXPORTAR.actual.pedidos || [], porId = new Map(ps.map((p) => [p.id, p])), out = [];
    for (let i = 0; i < ps.length; i += 150) {
      const ids = ps.slice(i, i + 150).map((p) => p.id);
      for (let d = 0; ; d += 1000) {
        const r = await SB.from('pedido_lineas').select('pedido_id,codigo,insumo,cantidad,unidad,subfamilia').in('pedido_id', ids).order('id').range(d, d + 999);
        if (r.error) throw new Error(r.error.message);
        (r.data || []).forEach((l) => out.push({ p: porId.get(l.pedido_id) || {}, l }));
        if (!r.data || r.data.length < 1000) break;
      }
    }
    return out;
  } };

EXPORTAR.defs.cruce = { nombre: 'cruce_dian', hoja: 'Cruce DIAN', columnas: [
  { t: 'Documento', v: (f) => f.documento }, { t: 'Tipo', v: (f) => f.tipo }, { t: 'Proveedor', v: (f) => f.proveedor }, { t: 'NIT', v: (f) => f.nit }, { t: 'Fecha', v: (f) => f.fecha }, { t: 'Sede', v: (f) => (typeof cruceSedeNombre === 'function' ? cruceSedeNombre(f) : null) },
  { t: 'Total', v: (f) => expNum(f.total) }, { t: 'DIAN', v: () => 'EN DIAN' }, { t: 'Web', v: (f) => f.web && f.web.estado }, { t: 'ERP', v: (f) => f.erp && f.erp.estado }, { t: 'Causación ERP', v: (f) => f.causacion },
  { t: 'Factura relacionada', v: (f) => f.factura_relacionada }, { t: 'Resultado', v: (f) => f.resultado }, { t: 'Motivo', v: (f) => f.motivo }, { t: 'CUFE', v: (f) => f.cufe } ] };

EXPORTAR.defs.precios = { nombre: 'variacion_de_precios', hoja: 'Variación de precios', columnas: [
  { t: 'Producto', v: (v) => v.articulo_texto }, { t: 'Proveedor', v: (v) => v.proveedor_nombre }, { t: 'NIT proveedor', v: (v) => v.proveedor_nit }, { t: 'Fecha', v: (v) => v.fecha_nueva }, { t: 'Fecha anterior', v: (v) => v.fecha_anterior },
  { t: 'Precio anterior', v: (v) => expNum(v.precio_anterior) }, { t: 'Precio nuevo', v: (v) => expNum(v.precio_nuevo) }, { t: 'Variación %', v: (v) => expNum(v.variacion_pct) }, { t: 'Estado', v: (v) => v.estado },
  { t: 'Base de comparación', v: (v) => v.base }, { t: 'Factura', v: (v) => v.factura_ref }, { t: 'Revisada por', v: (v) => v.revisada_por }, { t: 'Nota', v: (v) => v.nota } ] };

EXPORTAR.defs.admin_prov = { nombre: 'proveedores', hoja: 'Proveedores', columnas: [
  { t: 'Razón social', v: (x) => x.razon_social }, { t: 'Nombre comercial', v: (x) => x.nombre_comercial }, { t: 'NIT', v: (x) => x.nit }, { t: 'Teléfono / WhatsApp', v: (x) => x.telefono1 }, { t: 'Teléfono 2', v: (x) => x.telefono2 },
  { t: 'Correo', v: (x) => x.correo }, { t: 'Asesor', v: (x) => x.asesor },
  { t: 'Marcas', v: (x) => { const ids = (typeof adminVinc !== 'undefined' ? adminVinc : []).filter((v) => v.proveedor_id === x.id).map((v) => v.marca_id); return (typeof adminMarcas !== 'undefined' ? adminMarcas : []).filter((m) => ids.includes(m.id)).map((m) => m.nombre).join(', ') || 'sin marca'; } },
  { t: 'Artículos en el catálogo', v: (x) => (typeof adminCat !== 'undefined' ? adminCat : []).filter((k) => k.id_proveedor === x.id).length } ] };

EXPORTAR.defs.admin_art = { nombre: 'articulos', hoja: 'Artículos', columnas: [
  { t: 'Código', v: (x) => x.codigo_barras }, { t: 'Artículo', v: (x) => x.articulo_hiopos || x.articulo_comercial }, { t: 'Nombre comercial', v: (x) => x.articulo_comercial }, { t: 'Unidad de compra', v: (x) => x.unimedida_compra },
  { t: 'Unidad Hiopos', v: (x) => x.unimedida_hiopos }, { t: 'Subfamilia', v: (x) => x.subfamilia }, { t: 'Catálogo', v: () => EXPORTAR.catalogoArt || '' }, { t: 'Proveedores amarrados', v: (x) => x._prov == null ? null : x._prov }, { t: 'Precio menor', v: (x) => x._pmin }, { t: 'Precio mayor', v: (x) => x._pmax } ] };

EXPORTAR.defs.admin_cat = { nombre: 'que_le_compro_a_cada_proveedor', hoja: 'Qué le compro', columnas: [
  { t: 'Proveedor', v: (x) => x._prov }, { t: 'Código', v: (x) => x.codigo }, { t: 'Artículo', v: (x) => x.nombre }, { t: 'Precio negociado', v: (x) => expNum(x.k && x.k.precio_negociado) }, { t: 'Veces comprado', v: (x) => x.veces } ] };

EXPORTAR.defs.agente_avisos = { nombre: 'avisos_del_agente', hoja: 'Avisos del agente', columnas: [
  { t: 'Motivo', v: (r) => r.motivo }, { t: 'Detalle', v: (r) => r.detalle }, { t: 'Pedido', v: (r) => r.pedido_numero }, { t: 'Factura', v: (r) => r.factura_cufe }, { t: 'Fecha', v: (r) => (r.creado_en ? String(r.creado_en).slice(0, 16).replace('T', ' ') : null) } ] };
EXPORTAR.defs.agente_pend = { nombre: 'unidades_por_decidir', hoja: 'Unidades por decidir', columnas: [
  { t: 'Descripción', v: (r) => r.descripcion_original }, { t: 'Proveedor', v: (r) => r.proveedor_nombre }, { t: 'Pedido', v: (r) => r.pedido_numero }, { t: 'Fecha', v: (r) => (r.creado_en ? String(r.creado_en).slice(0, 16).replace('T', ' ') : null) }, { t: 'Motivo', v: (r) => r.motivo }, { t: 'Sugerencia', v: (r) => r.sugerencia } ] };
EXPORTAR.defs.agente_nombres = { nombre: 'nombres_por_decidir', hoja: 'Nombres por decidir', columnas: [
  { t: 'Texto de la factura', v: (r) => r.texto_factura }, { t: 'Proveedor', v: (r) => r.proveedor_nombre }, { t: 'Pedido', v: (r) => r.pedido_numero }, { t: 'Fecha', v: (r) => (r.creado_en ? String(r.creado_en).slice(0, 16).replace('T', ' ') : null) },
  { t: 'Sugerencias', v: (r) => (r.sugerencias || []).map((s) => s.nombre).join(' | ') } ] };
EXPORTAR.defs.agente_reglas = { nombre: 'reglas_aprendidas', hoja: 'Reglas aprendidas', columnas: [
  { t: 'Producto', v: (r) => r.producto_norm }, { t: 'Presentación', v: (r) => r.presentacion }, { t: 'Unidad', v: (r) => r.unidad }, { t: 'Proveedor', v: (r) => r.proveedor_nombre || r.proveedor_nit }, { t: 'Confirmaciones', v: (r) => expNum(r.n) },
  { t: 'En contra', v: (r) => expNum(r.contradicciones) }, { t: 'Nivel', v: (r) => r.nivel }, { t: 'Estado', v: (r) => r.estado }, { t: 'Requiere revisión', v: (r) => !!r.requiere_revision }, { t: 'Confirmada por admin', v: (r) => !!r.confirmada_admin }, { t: 'Última', v: (r) => (r.ultima_en ? String(r.ultima_en).slice(0, 16).replace('T', ' ') : null) } ] };

EXPORTAR.defs.usuarios = { nombre: 'usuarios', hoja: 'Usuarios', columnas: [
  { t: 'Nombre', v: (u) => u.nombre }, { t: 'Correo', v: (u) => u.email }, { t: 'Perfil', v: (u) => u.perfil || u.rol }, { t: 'Nivel', v: (u) => u.rol },
  { t: 'Sede / sedes asignadas', v: (u) => (u.rol === 'pagos' ? (((typeof USR !== 'undefined' && USR.sedesAnalista && USR.sedesAnalista[u.user_id]) || []).map(expSede).filter(Boolean).join(' | ') || 'todas (sin sedes asignadas)') : (u.sede ? (u.marca ? u.marca + ' · ' : '') + u.sede : 'todas')) },
  { t: 'Correo de avisos', v: (u) => (typeof USR !== 'undefined' && USR.avisos && USR.avisos[u.user_id]) || null }, { t: 'Activo', v: (u) => !!u.activo }, { t: 'Debe cambiar la contraseña', v: (u) => !!u.debe_cambiar_clave }, { t: 'Último ingreso', v: (u) => (u.ultimo_ingreso ? String(u.ultimo_ingreso).slice(0, 16).replace('T', ' ') : null) } ] };
EXPORTAR.defs.perfiles = { nombre: 'perfiles', hoja: 'Perfiles', columnas: [
  { t: 'Perfil', v: (p) => p.nombre }, { t: 'Descripción', v: (p) => p.descripcion }, { t: 'Nivel de datos', v: (p) => p.nivel }, { t: 'De origen', v: (p) => !!p.sistema }, { t: 'Activo', v: (p) => !!p.activo },
  { t: 'Permisos', v: (p) => ((typeof USR !== 'undefined' && USR.permisosPorPerfil && USR.permisosPorPerfil[p.id]) || []).length } ] };

// ---- botones (HTML) y descarga
function exportarBotones(clave, opciones) {
  const o = opciones || {};
  return `<span class="row" style="gap:6px;display:inline-flex;margin:0;align-items:center">${o.etiqueta ? `<span class="mut">${o.etiqueta}</span>` : ''}<button title="Descargar en Excel (.xlsx) lo que estás viendo, con los filtros y la búsqueda aplicados" onclick="exportarDescargar('${clave}','xlsx')">⬇ Excel</button><button title="Descargar en CSV (separado por punto y coma, abre en Excel)" onclick="exportarDescargar('${clave}','csv')">⬇ CSV</button></span>`;
}
function exportarBajar(blob, nombre) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function exportarDescargar(clave, formato) {
  const d = EXPORTAR.defs[clave];
  if (!d) { alert('Este listado no se puede descargar.'); return; }
  try {
    document.body.style.cursor = 'progress';
    const datos = typeof d.datos === 'function' ? await d.datos() : (typeof EXPORTAR.actual[clave] === 'function' ? EXPORTAR.actual[clave]() : EXPORTAR.actual[clave]);
    const m = Exportar.matriz(d.columnas, datos);
    if (!Exportar.hayDatos(m)) { alert('No hay datos para descargar con los filtros actuales.'); return; }
    const hoy = (typeof BancoUtils !== 'undefined' && BancoUtils.hoyColombia) ? BancoUtils.hoyColombia() : new Date().toISOString().slice(0, 10);
    if (formato === 'xlsx') {
      let buf; try { buf = Exportar.libro(m, d.hoja, typeof XLSX !== 'undefined' ? XLSX : null); } catch (e) { alert(e.message + '\n\nSe descarga el CSV.'); formato = 'csv'; }
      if (formato === 'xlsx') { exportarBajar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), Exportar.nombreArchivo(d.nombre, 'xlsx', hoy)); return; }
    }
    exportarBajar(new Blob([Exportar.csv(m)], { type: 'text/csv;charset=utf-8' }), Exportar.nombreArchivo(d.nombre, 'csv', hoy));
  } catch (e) { alert('No se pudo preparar la descarga: ' + (e.message || e)); }
  finally { document.body.style.cursor = ''; }
}

// Los botones fijos del HTML (<span data-exp="clave">) se llenan al cargar la pagina
function exportarMontarBotones() {
  document.querySelectorAll('[data-exp]').forEach((el) => { el.innerHTML = exportarBotones(el.getAttribute('data-exp'), { etiqueta: el.getAttribute('data-etiqueta') || '' }); });
}
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', exportarMontarBotones);
