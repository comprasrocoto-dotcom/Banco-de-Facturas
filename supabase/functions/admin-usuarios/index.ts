// ============================================================
//  Edge Function `admin-usuarios`  -  crear usuarios de acceso, cambiar su estado y restablecer su contrasena  (25/09/2026)
//  Por que existe: crear/bloquear un usuario de acceso (Supabase Auth) exige la llave de SERVICIO, que no puede estar en la web ni en el repositorio (es publico).
//  Esa llave la inyecta Supabase en el entorno de esta funcion (SUPABASE_SERVICE_ROLE_KEY): aqui no hay ningun secreto.
//  Seguridad: solo entra quien tenga el permiso `admin.usuarios` (se pregunta a la base con el token de QUIEN LLAMA, funcion usuario_puede_gestionar).
//  Las reglas de negocio (perfil valido, sede obligatoria para sede, ultimo administrador, no auto-desactivarse) viven en la base (usuario_registrar / usuario_actualizar),
//  llamadas con el token de quien llama: la funcion solo hace lo que la base no puede (el usuario de Auth).
//  La contrasena nunca se escribe en logs ni se devuelve.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const RX_CORREO = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const CLAVE_MIN = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const yo = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: puede } = await yo.rpc("usuario_puede_gestionar");
    if (puede !== true) return json({ error: "No tienes permiso para gestionar usuarios." }, 403);

    const b = await req.json().catch(() => ({}));
    const msg = (e: { message?: string } | null) => String(e?.message ?? "error").slice(0, 300);

    if (b.accion === "crear") {
      const email = String(b.email ?? "").trim().toLowerCase(), clave = String(b.clave ?? ""), nombre = String(b.nombre ?? "").trim();
      if (!RX_CORREO.test(email)) return json({ error: "El correo no es valido." }, 400);
      if (clave.length < CLAVE_MIN) return json({ error: `La contrasena temporal debe tener al menos ${CLAVE_MIN} caracteres.` }, 400);
      if (!nombre) return json({ error: "Falta el nombre." }, 400);
      const { data: nuevo, error: e1 } = await admin.auth.admin.createUser({ email, password: clave, email_confirm: true, user_metadata: { nombre } });
      if (e1 || !nuevo?.user) return json({ error: /already|registered|exists/i.test(msg(e1)) ? "Ya existe un usuario con ese correo." : "No se pudo crear el usuario: " + msg(e1) }, 400);
      const id = nuevo.user.id;
      const { error: e2 } = await yo.rpc("usuario_registrar", { p_user_id: id, p_nombre: nombre, p_perfil_id: b.perfil_id, p_sede_id: b.sede_id ?? null, p_debe_cambiar: true });
      if (e2) { await admin.auth.admin.deleteUser(id); return json({ error: msg(e2) }, 400); }   // no queda un usuario de acceso sin perfil
      return json({ ok: true, user_id: id });
    }

    if (b.accion === "actualizar") {
      const { error: e1 } = await yo.rpc("usuario_actualizar", { p_user_id: b.user_id, p_nombre: b.nombre, p_perfil_id: b.perfil_id, p_sede_id: b.sede_id ?? null, p_activo: b.activo });
      if (e1) return json({ error: msg(e1) }, 400);
      // desactivado = tambien bloqueado en Auth (no puede ni iniciar sesion)
      const { error: e2 } = await admin.auth.admin.updateUserById(b.user_id, { ban_duration: b.activo === false ? "876000h" : "none" });
      if (e2) return json({ ok: true, aviso: "Se guardo, pero no se pudo actualizar el bloqueo de acceso: " + msg(e2) });
      return json({ ok: true });
    }

    if (b.accion === "clave") {
      const clave = String(b.clave ?? "");
      if (clave.length < CLAVE_MIN) return json({ error: `La contrasena temporal debe tener al menos ${CLAVE_MIN} caracteres.` }, 400);
      const { error: e1 } = await yo.rpc("usuario_forzar_cambio", { p_user_id: b.user_id });
      if (e1) return json({ error: msg(e1) }, 400);
      const { error: e2 } = await admin.auth.admin.updateUserById(b.user_id, { password: clave });
      if (e2) return json({ error: "No se pudo cambiar la contrasena: " + msg(e2) }, 400);
      return json({ ok: true });
    }

    return json({ error: "Accion desconocida." }, 400);
  } catch (e) {
    return json({ error: "Error inesperado: " + String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
});
