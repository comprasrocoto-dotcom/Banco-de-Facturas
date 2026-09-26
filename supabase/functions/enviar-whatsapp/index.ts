// ============================================================
//  Edge Function `enviar-whatsapp`  -  manda el PEDIDO al WhatsApp del proveedor, con el PDF ADJUNTO, por la API OFICIAL (WhatsApp Business Cloud API de Meta)  (26/09/2026)
//  Sin configurar (secretos vacios) no hace nada: la web sigue con el metodo manual. Secretos (Supabase > Edge Functions > Secrets; NUNCA en el codigo ni en Git):
//    WA_TOKEN         token de acceso permanente de WhatsApp Business (usuario del sistema de Meta)
//    WA_PHONE_ID      id del numero de telefono de WhatsApp Business
//    WA_PLANTILLA     (opcional) nombre de la plantilla aprobada. Por defecto: pedido_proveedor
//    WA_IDIOMA        (opcional) idioma de la plantilla. Por defecto: es
//  Seguridad: solo entra quien tenga el permiso `pedidos.enviar_proveedor` (se pregunta a la base con el token de QUIEN LLAMA); el telefono se toma del PROVEEDOR del pedido
//  (no del navegador); el pedido se lee con las reglas de seguridad de esa persona; solo se lee un PDF de la carpeta pedidos/ del bucket privado.
//  El PDF se sube a Meta como archivo (no se expone ningun enlace) y se manda como encabezado de una plantilla aprobada.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { VERSION_API, normalizarTelefono, rutaValida, armarPlantilla, nombreArchivo, interpretarErrorMeta } from "./logica.mjs";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const yo = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: puede } = await yo.rpc("tiene_permiso", { p: "pedidos.enviar_proveedor" });
    if (puede !== true) return json({ error: "No tienes permiso para enviar pedidos al proveedor." }, 403);

    const token = Deno.env.get("WA_TOKEN"), phoneId = Deno.env.get("WA_PHONE_ID");
    const b = await req.json().catch(() => ({}));
    if (b.accion === "estado") return json({ configurado: !!(token && phoneId) });
    if (b.accion !== "enviar") return json({ error: "Accion desconocida." }, 400);
    if (!token || !phoneId) return json({ error: "WhatsApp Business no esta configurado.", codigo: "sin_configurar" }, 409);

    const plantilla = Deno.env.get("WA_PLANTILLA") || "pedido_proveedor", idioma = Deno.env.get("WA_IDIOMA") || "es";
    if (!rutaValida(b.ruta)) return json({ error: "Ruta del PDF no valida." }, 400);

    // pedido y proveedor: con los permisos de quien llama (si no ve el pedido, no lo puede mandar)
    const { data: ped, error: e1 } = await yo.from("pedidos").select("id,numero,fecha,proveedor_id,observacion_pedido").eq("id", b.pedido_id).single();
    if (e1 || !ped) return json({ error: "No encontre el pedido." }, 404);
    if (!ped.proveedor_id) return json({ error: "El pedido no tiene proveedor." }, 400);
    const { data: prov } = await yo.from("proveedores").select("razon_social,telefono1").eq("id", ped.proveedor_id).single();
    const para = normalizarTelefono(prov?.telefono1);
    if (!para) return json({ error: "El proveedor no tiene un WhatsApp (celular) valido registrado." }, 400);

    // el PDF que la web acaba de guardar
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: archivo, error: e2 } = await admin.storage.from("facturas").download(b.ruta);
    if (e2 || !archivo) return json({ error: "No encontre el PDF del pedido en el almacenamiento." }, 404);

    const base = `https://graph.facebook.com/${VERSION_API}/${phoneId}`;
    // 1) subir el PDF a Meta
    const form = new FormData();
    form.append("messaging_product", "whatsapp"); form.append("type", "application/pdf");
    form.append("file", new File([await archivo.arrayBuffer()], nombreArchivo(ped.numero), { type: "application/pdf" }));
    const rm = await fetch(`${base}/media`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    const jm = await rm.json().catch(() => null);
    if (!rm.ok || !jm?.id) return json({ error: interpretarErrorMeta(rm.status, jm) }, 502);

    // 2) mandar la plantilla con el PDF de encabezado
    const rs = await fetch(`${base}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(armarPlantilla({ para, plantilla, idioma, mediaId: jm.id, numero: ped.numero, fecha: ped.fecha, observaciones: ped.observacion_pedido })),
    });
    const js = await rs.json().catch(() => null);
    if (!rs.ok || !js?.messages?.[0]?.id) return json({ error: interpretarErrorMeta(rs.status, js) }, 502);
    return json({ ok: true, wamid: js.messages[0].id, destinatario: para });
  } catch (e) {
    return json({ error: "Error inesperado: " + String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
});
