// ============================================================
//  correo-servidor.js  -  pide al SERVIDOR que mande los correos de la cola (16/10/2026, pedido del usuario)
// ============================================================
// Los correos (tareas nuevas, alertas, pedidos al proveedor, avisos) quedan en correo_cola. Antes solo salian si un PC tenia el
// vigilante abierto; ahora la web llama la Edge Function `enviar-correos` al cargar, al asignar una tarea, al generar las alertas y
// cada 3 minutos mientras alguien tenga la pagina abierta. Si el servidor aun no tiene los secretos de Gmail, no insiste (vuelve a
// probar cada 10 minutos) y los correos siguen esperando al vigilante, como antes. Nombres globales con prefijo cs / CS_.
var CS_ESTADO = { ultimo: 0, configurado: null, ultimoResultado: null, intervalo: null };

async function csEnviarCola(forzar) {
  if (typeof SB === 'undefined' || !SB.functions || typeof usuario === 'undefined' || !usuario) return null;
  const ahora = Date.now();
  if (!forzar && ahora - CS_ESTADO.ultimo < 60000) return null;                                   // como mucho una vez por minuto
  if (!forzar && CS_ESTADO.configurado === false && ahora - CS_ESTADO.ultimo < 10 * 60000) return null;   // sin secretos: cada 10 min
  CS_ESTADO.ultimo = ahora;
  try {
    const r = await SB.functions.invoke('enviar-correos', { body: {} });
    const d = (r && r.data) || null;
    if (d) { CS_ESTADO.configurado = d.configurado !== false; CS_ESTADO.ultimoResultado = d; }
    return d;
  } catch (e) { return null; }
}
// arranca el envio periodico (una sola vez por pagina)
function csIniciar() {
  csEnviarCola();
  if (!CS_ESTADO.intervalo && typeof setInterval === 'function') CS_ESTADO.intervalo = setInterval(() => { csEnviarCola(); }, 3 * 60000);
}
