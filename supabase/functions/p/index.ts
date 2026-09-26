// ============================================================
//  Edge Function `p`  -  ENLACE CORTO al PDF de un pedido  (26/09/2026)
//  El mensaje de WhatsApp lleva https://<dominio>/p/<codigo> (vercel.json lo reenvia aqui). Si el codigo existe, no esta revocado y no ha vencido, responde con una
//  redireccion al PDF PRIVADO usando un enlace temporal de 1 hora: el archivo nunca queda publico y el enlace corto se puede revocar (pedido_pdf_enlace.revocado).
//  Es un endpoint abierto a proposito (lo abre el proveedor, sin cuenta): solo responde a un codigo valido; todo lo demas es 404. No registra ni devuelve datos del pedido.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const texto = (t: string, status: number) => new Response(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const NO_VALE = "Este enlace venció o no es válido. Pídele a quien te envió el pedido que lo vuelva a enviar.";

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return texto("Metodo no permitido", 405);
  try {
    const codigo = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
    if (!/^[a-z0-9]{8,20}$/.test(codigo)) return texto(NO_VALE, 404);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: fila } = await admin.from("pedido_pdf_enlace").select("ruta,expira_en,revocado").eq("codigo", codigo).maybeSingle();
    if (!fila || fila.revocado || new Date(fila.expira_en).getTime() < Date.now()) return texto(NO_VALE, 404);
    const { data: firma, error } = await admin.storage.from("facturas").createSignedUrl(fila.ruta, 3600);
    if (error || !firma?.signedUrl) return texto(NO_VALE, 404);
    return new Response(null, { status: 302, headers: { Location: firma.signedUrl, "Cache-Control": "no-store" } });
  } catch (_) {
    return texto("No se pudo abrir el enlace. Intenta de nuevo en un momento.", 500);
  }
});
