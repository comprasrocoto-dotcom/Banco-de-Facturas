// ============================================================
//  Edge Function `enviar-correos`  -  manda los correos de la cola (correo_cola) DESDE EL SERVIDOR (16/10/2026, pedido del usuario)
//  Antes solo salian si algun PC tenia el vigilante abierto. Ahora la web llama esta funcion al cargar, al asignar una tarea y cada
//  pocos minutos mientras alguien la tenga abierta: los correos salen aunque ningun vigilante este prendido.
//  Usa las mismas funciones de la base que el vigilante (correo_tomar reserva, correo_resultado marca): nunca se duplica un correo
//  aunque el vigilante y el servidor esten encendidos a la vez. Envio por SMTP de Gmail con contraseña de aplicacion (como lib/smtp-gmail.js).
//  Secretos (Supabase > Edge Functions > Secrets; NUNCA en el codigo ni en Git): GMAIL_APP_USUARIO, GMAIL_APP_CLAVE
//  (los mismos de banco_web/.env.local). Sin secretos no hace nada (los correos esperan al vigilante, como antes).
//  Seguridad: solo la llama un usuario con sesion iniciada; solo manda lo que ya esta en la cola; la clave nunca se guarda en errores.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { armarMime, cuerpoData, direcciones, errorSeguro } from "./logica.mjs";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const enc = new TextEncoder(), dec = new TextDecoder();

// cliente SMTP minimo con TLS directo al 465 (EHLO, AUTH LOGIN, MAIL FROM, RCPT TO, DATA, QUIT)
async function smtpEnviar(usuario: string, clave: string, rcpt: string[], mime: string) {
  const conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });
  let buf = "";
  const leer = async (): Promise<{ codigo: number; texto: string }> => {
    const tope = Date.now() + 60000;
    while (Date.now() < tope) {
      const lineas = buf.split("\r\n");
      const ult = lineas.length > 1 ? lineas[lineas.length - 2] : "";
      if (lineas[lineas.length - 1] === "" && /^\d{3}( |$)/.test(ult)) { const t = buf; buf = ""; return { codigo: Number(ult.slice(0, 3)), texto: t.replace(/\r\n/g, " | ").slice(0, 300) }; }
      const p = new Uint8Array(8192); const n = await conn.read(p);
      if (n === null) throw new Error("el servidor de correo cerró la conexión");
      buf += dec.decode(p.subarray(0, n));
    }
    throw new Error("el servidor de correo no respondió a tiempo");
  };
  const escribir = async (s: string) => { const d = enc.encode(s + "\r\n"); let o = 0; while (o < d.length) o += await conn.write(d.subarray(o)); };
  const paso = async (linea: string | null, esperado: number[], que: string) => {
    if (linea !== null) await escribir(linea);
    const r = await leer();
    if (!esperado.includes(r.codigo)) throw new Error(que + ": el servidor respondió " + r.texto);
    return r;
  };
  try {
    await paso(null, [220], "saludo");
    await paso("EHLO banco-facturas", [250], "EHLO");
    await paso("AUTH LOGIN", [334], "AUTH");
    await paso(btoa(usuario), [334], "usuario");
    try { await paso(btoa(clave), [235], "contraseña"); } catch (_) { throw new Error("Gmail rechazó el usuario o la contraseña de aplicación (revisa los secretos GMAIL_APP_USUARIO / GMAIL_APP_CLAVE)."); }
    await paso("MAIL FROM:<" + usuario + ">", [250], "remitente");
    for (const d of rcpt) await paso("RCPT TO:<" + d + ">", [250, 251], "destinatario " + d);
    await paso("DATA", [354], "DATA");
    await paso(cuerpoData(mime) + "\r\n.", [250], "envío");
    await paso("QUIT", [221], "QUIT").catch(() => {});
  } finally { try { conn.close(); } catch (_) { /* ya cerrada */ } }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const yo = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: quien } = await yo.auth.getUser();
    if (!quien || !quien.user) return json({ error: "Inicia sesión." }, 401);
    const usuario = (Deno.env.get("GMAIL_APP_USUARIO") || "").trim(), clave = (Deno.env.get("GMAIL_APP_CLAVE") || "").replace(/\s+/g, "");
    if (!usuario || !clave) return json({ configurado: false, mensaje: "Faltan los secretos GMAIL_APP_USUARIO / GMAIL_APP_CLAVE: los correos siguen esperando al vigilante." });
    const b = await req.json().catch(() => ({}));
    if (b && b.accion === "estado") return json({ configurado: true });

    const adm = createClient(url, service, { auth: { persistSession: false } });
    const { data: filas, error } = await adm.rpc("correo_tomar", { p_limite: 5 });
    if (error) return json({ error: "No pude leer la cola: " + error.message }, 500);
    const res = { configurado: true, intentados: 0, enviados: 0, errores: 0 };
    for (const c of (filas || []) as Array<Record<string, any>>) {
      res.intentados++;
      try {
        const rcpt = direcciones(c.destinatario, c.cc);
        if (!rcpt.length) throw new Error("sin destinatarios válidos");
        let adjunto = null;
        if (c.archivo_pdf) {
          const d = await adm.storage.from("facturas").download(c.archivo_pdf);
          if (d.error || !d.data) throw new Error("no pude bajar el adjunto " + c.archivo_pdf);
          adjunto = { nombre: String(c.archivo_pdf).split("/").pop(), bytes: new Uint8Array(await d.data.arrayBuffer()) };
        }
        await smtpEnviar(usuario, clave, rcpt, armarMime({ de: usuario, para: c.destinatario, cc: c.cc, asunto: c.asunto, cuerpo: c.cuerpo, adjunto }));
        await adm.rpc("correo_resultado", { p_id: c.id, p_ok: true, p_error: null, p_gmail_id: "servidor" });
        res.enviados++;
      } catch (e) {
        await adm.rpc("correo_resultado", { p_id: c.id, p_ok: false, p_error: "servidor: " + errorSeguro(e, clave), p_gmail_id: null });
        res.errores++;
      }
    }
    return json(res);
  } catch (e) {
    return json({ error: errorSeguro(e, Deno.env.get("GMAIL_APP_CLAVE") || "") }, 500);
  }
});
