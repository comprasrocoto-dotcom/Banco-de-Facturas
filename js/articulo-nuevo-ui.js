// ============================================================
//  articulo-nuevo-ui.js  -  Admin > Artículos > «➕ Nuevo»: UNA ventana con todos los campos  (07/11/2026, pedido del usuario:
//  «que al asociar un articulo ... salga una ventana con todos los campos, pero que no se cierre la ventana»)
// ============================================================
// Antes eran varias ventanitas seguidas (codigo, nombre, unidad, familia...) y si una se cancelaba se perdia todo. Ahora:
//  - una sola ventana: lista (general o marca con catalogo propio), codigo *, nombre *, unidad, familia y, si se quiere,
//    el proveedor al que se le compra con su precio (queda amarrado de una vez);
//  - NO pide sede; no se cierra al tocar afuera ni cuando hay un error (se corrige ahi mismo);
//  - al crear, avisa «✅ creado» y deja la ventana abierta y limpia para crear otro (se cierra con «Cerrar»).
// Usa los datos ya cargados de Admin (adminArt, adminMarcaArts, adminProv, adminVinc, adminMarcas). Prefijo an / AN.
const AN = { creados: 0 };

const anVal = (id) => String((document.getElementById(id) || {}).value || '').trim();
const anEsc = (s) => (typeof escAg === 'function' ? escAg(s) : String(s == null ? '' : s));

// validacion pura de lo escrito -> { ok, errores[], datos }
function anValidar(d, existentes) {
  const errores = [];
  const codigo = AdminEditar.normalizarCodigo(d.codigo || '');
  const vc = AdminEditar.validarCodigo('', codigo, existentes || [], -1);
  if (!vc.ok) errores.push(vc.error);
  const nombre = String(d.nombre || '').replace(/\s+/g, ' ').trim();
  if (!nombre) errores.push('Escribe el nombre del artículo.');
  const unidad = AdminEditar.normalizarUnidad(d.unidad || '');
  let precio = null;
  if (String(d.precio || '').trim()) {
    precio = Number(String(d.precio).replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.'));
    if (!isFinite(precio) || precio < 0) errores.push('El precio no es un número válido.');
  }
  if (precio != null && !d.proveedor) errores.push('Para poner precio elige también el proveedor.');
  return { ok: !errores.length, errores, datos: { codigo, nombre, unidad: unidad || null, familia: d.familia || null, proveedor: d.proveedor ? Number(d.proveedor) : null, precio } };
}

function anListaElegida() { return Number(anVal('an_lista')) || 0; }   // 0 = general; id = marca con catalogo propio
function anExistentes(lista) {
  return lista ? MarcaProv.articulosAdmin(adminMarcaArts, lista) : adminArt;
}
function anProveedores(lista) {
  return lista ? MarcaProv.proveedoresDeAdmin(adminProv, adminVinc, lista) : MarcaProv.proveedoresDelGeneral(adminProv, adminVinc, adminMarcas);
}
function anPintarProveedores() {
  const lista = anListaElegida(), sel = document.getElementById('an_prov'); if (!sel) return;
  const cur = sel.value, ps = anProveedores(lista);
  sel.innerHTML = '<option value="">— ninguno por ahora —</option>' + ps.map((p) => `<option value="${p.id}">${anEsc(p.razon_social || p.nombre_comercial || '')}${p.nit ? ' · NIT ' + anEsc(p.nit) : ''}</option>`).join('');
  if (ps.some((p) => String(p.id) === cur)) sel.value = cur;
  const aviso = document.getElementById('an_lista_aviso');
  if (aviso) aviso.textContent = lista && !adminMarcaArts.some((a) => a.marca_id === lista)
    ? '⚠️ Esta marca todavía no tiene lista propia: al crear su primer artículo, en «Nuevo pedido» dejará de ver la lista general y solo verá los suyos.' : '';
}

function artNuevoAbrir() {
  let m = document.getElementById('modalArtNuevo');
  if (m) m.remove();
  const listaIni = Number(((document.getElementById('admCatalogo') || {}).value)) || 0;
  const unidades = AdminEditar.unidadesConocidas(adminArt.concat(MarcaProv.articulosAdmin(adminMarcaArts, listaIni)), []);
  const familias = AdminEditar.familiasConocidas ? AdminEditar.familiasConocidas([adminArt, adminMarcaArts]) : [];
  const listas = [{ id: 0, nombre: 'Rocoto y Arrebatao (catálogo general)' }].concat(MarcaProv.marcasPropias(adminMarcas).map((mm) => ({ id: mm.id, nombre: mm.nombre + ' (catálogo propio)' })));
  const campo = (id, etiqueta, extra, ancho) => `<label style="display:block;flex:${ancho || 1} 1 220px"><span class="mut">${etiqueta}</span><input id="${id}" ${extra || ''} style="margin:2px 0 0;width:100%" autocomplete="off"></label>`;
  m = document.createElement('div');
  m.id = 'modalArtNuevo'; m.className = 'modal on';   // sin cierre al tocar afuera: solo con «Cerrar»
  m.innerHTML = `<div class="card" style="max-width:720px">
    <div class="row"><div><h1 style="margin:0">➕ Nuevo artículo</h1><div class="mut">Crea una referencia. Los campos con * son obligatorios. No pide sede.</div></div><span class="sp"></span><button onclick="artNuevoCerrar()">✖ Cerrar</button></div>
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px">
      <label style="display:block;flex:2 1 260px"><span class="mut">Lista (catálogo) *</span>
        <select id="an_lista" style="margin:2px 0 0;width:100%" onchange="anPintarProveedores()">${listas.map((l) => `<option value="${l.id}"${l.id === listaIni ? ' selected' : ''}>${anEsc(l.nombre)}</option>`).join('')}</select></label>
      ${campo('an_codigo', 'Código * (el del ERP)', 'placeholder="ej. ORD900 o código de barras" style="text-transform:uppercase"')}
    </div>
    <div class="mut" id="an_lista_aviso" style="color:#b45309;font-size:12.5px"></div>
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:6px">${campo('an_nombre', 'Nombre * (como en el ERP / Hiopos)', 'placeholder="ej. FILETE DE ATUN"', 3)}</div>
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:6px">
      ${campo('an_unidad', 'Unidad de medida (compra)', 'list="an_ul" placeholder="KILO, UNIDADES, UNDX400G…" style="text-transform:uppercase"')}
      <datalist id="an_ul">${unidades.slice(0, 300).map((u) => `<option value="${anEsc(u)}">`).join('')}</datalist>
      ${campo('an_familia', 'Familia', 'list="an_fl" placeholder="ABARROTES, FRUVER…" style="text-transform:uppercase"')}
      <datalist id="an_fl">${familias.map((u) => `<option value="${anEsc(u)}">`).join('')}</datalist>
    </div>
    <div style="margin-top:10px;padding:8px 10px;background:#f8fafc;border:1px solid var(--line);border-radius:9px">
      <div class="mut" style="font-weight:700">Proveedor al que se le compra (opcional)</div>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:4px">
        <label style="display:block;flex:3 1 280px"><span class="mut">Proveedor</span><select id="an_prov" data-buscable style="margin:2px 0 0;width:100%"></select></label>
        ${campo('an_precio', 'Precio negociado', 'inputmode="decimal" placeholder="sin precio"')}
      </div></div>
    <div id="an_msg" style="margin-top:10px;font-weight:600"></div>
    <div class="row" style="margin-top:10px"><span class="mut" id="an_cuenta"></span><span class="sp"></span>
      <button onclick="artNuevoCerrar()">Cerrar</button><button class="p" id="an_crear" onclick="artNuevoCrear()">Crear artículo</button></div></div>`;
  document.body.appendChild(m);
  AN.creados = 0;
  anPintarProveedores();
  setTimeout(() => { const c = document.getElementById('an_codigo'); if (c) c.focus(); }, 60);
}

async function artNuevoCerrar() {
  const m = document.getElementById('modalArtNuevo'); if (m) m.remove();
  if (AN.creados) { adminCargado = false; await cargarAdmin(); }
}

async function artNuevoCrear() {
  const msg = document.getElementById('an_msg'), btn = document.getElementById('an_crear');
  const lista = anListaElegida();
  const familias = AdminEditar.familiasConocidas ? AdminEditar.familiasConocidas([adminArt, adminMarcaArts]) : [];
  const v = anValidar({ codigo: anVal('an_codigo'), nombre: anVal('an_nombre'), unidad: anVal('an_unidad'),
    familia: AdminEditar.familiaElegida ? AdminEditar.familiaElegida(anVal('an_familia'), familias) : anVal('an_familia').toUpperCase(),
    proveedor: anVal('an_prov'), precio: anVal('an_precio') }, anExistentes(lista));
  if (!v.ok) { msg.style.color = '#b91c1c'; msg.textContent = '⚠️ ' + v.errores.join(' '); return; }
  const d = v.datos;
  if (lista && !adminMarcaArts.some((a) => a.marca_id === lista) && !confirm('Esta marca todavía no tiene lista propia.\n\nAl crear su primer artículo, en «Nuevo pedido» dejará de ver la lista general y solo verá los suyos. ¿Continuar?')) return;
  btn.disabled = true; msg.style.color = ''; msg.textContent = 'Creando…';
  try {
    let r;
    if (lista) r = await SB.from('marca_articulo').insert({ marca_id: lista, codigo_barras: d.codigo, articulo: d.nombre, unidad_compra: d.unidad, subfamilia: d.familia }).select('*').single();
    else r = await SB.from('articulos').insert({ codigo_barras: d.codigo, articulo_hiopos: d.nombre, articulo_comercial: d.nombre, unimedida_compra: d.unidad, subfamilia: d.familia }).select('*').single();
    if (r.error) throw new Error(/duplicate|unique/i.test(r.error.message) ? 'ya existe un artículo con ese código en esa lista.' : r.error.message);
    if (lista) adminMarcaArts.push(r.data); else adminArt.push(r.data);
    let amarre = '';
    if (d.proveedor) {
      const fila = { codigo_barras: d.codigo, id_proveedor: d.proveedor, prioridad: 1, precio_negociado: d.precio, estado: 'Aprobado' };
      const ra = lista ? await SB.from('marca_catalogo').upsert(Object.assign({ marca_id: lista }, fila), { onConflict: 'marca_id,codigo_barras,id_proveedor' })
        : await SB.from('catalogo_compras').upsert(fila, { onConflict: 'codigo_barras,id_proveedor' });
      const p = adminProv.find((x) => x.id === d.proveedor) || {};
      amarre = ra.error ? ' ⚠️ Pero no se pudo amarrar al proveedor: ' + ra.error.message + ' (hazlo con «＋ Amarrar / poner precio»).'
        : ' Amarrado a ' + (p.razon_social || p.nombre_comercial || 'el proveedor') + (d.precio != null ? ' a ' + (typeof money === 'function' ? money(d.precio) : d.precio) : ' (sin precio)') + '.';
    }
    AN.creados++;
    if (typeof marcaArts !== 'undefined') { marcaArts = []; marcaCat = []; provs = []; }   // «Nuevo pedido» vuelve a leer sus listas
    msg.style.color = '#166534'; msg.textContent = '✅ Creado: ' + d.codigo + ' · ' + d.nombre + '.' + amarre + ' Puedes crear otro.';
    ['an_codigo', 'an_nombre', 'an_precio'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('an_cuenta').textContent = AN.creados + ' creado(s) en esta ventana';
    const c = document.getElementById('an_codigo'); if (c) c.focus();
  } catch (e) {
    msg.style.color = '#b91c1c'; msg.textContent = '⚠️ No se pudo crear: ' + e.message;
  } finally { btn.disabled = false; }
}

if (typeof module === 'object' && module.exports) module.exports = { anValidar };
