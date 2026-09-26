-- ============================================================
--  ENLACE CORTO AL PDF DEL PEDIDO (mensaje de WhatsApp)  -  26/09/2026
--  El mensaje lleva https://<dominio>/p/<codigo>. vercel.json lo reenvia a la Edge Function `p`, que (si el codigo existe, no esta revocado y no ha vencido) redirige al PDF
--  PRIVADO del bucket "facturas" con un enlace temporal de 1 hora. El PDF nunca queda publico.
--  SOLO AGREGA: 1 tabla (pedido_pdf_enlace: codigo -> ruta, con vencimiento y revocacion) y 1 funcion para crear el enlace. La tabla no se lee ni escribe desde la web (sin politicas);
--  solo la funcion (con permiso de enviar pedidos) y la Edge Function `p` (con la llave de servicio).
-- ============================================================
create table if not exists pedido_pdf_enlace (
  codigo     text primary key check (codigo ~ '^[a-z0-9]{8,20}$'),
  ruta       text not null check (ruta ~ '^pedidos/[A-Za-z0-9._-]+\.pdf$'),
  pedido_id  bigint references pedidos(id) on delete cascade,
  creado_por uuid,
  creado_en  timestamptz not null default now(),
  expira_en  timestamptz not null,
  revocado   boolean not null default false
);
create index if not exists pedido_pdf_enlace_pedido_idx on pedido_pdf_enlace (pedido_id);
alter table pedido_pdf_enlace enable row level security;
revoke all on pedido_pdf_enlace from anon, authenticated;

create or replace function pedido_pdf_enlace_crear(p_pedido_id bigint, p_ruta text, p_codigo text, p_dias int default 30)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_ok boolean;
begin
  select (mi_rol() = any (array['admin', 'pagos']) or (mi_rol() = 'sede' and (p.sede_id = mi_sede() or p.marca_id = mi_marca())))
    into v_ok from pedidos p where p.id = p_pedido_id;
  if v_ok is not true or not tiene_permiso('pedidos.enviar_proveedor') then raise exception 'sin permiso para crear el enlace de este pedido' using errcode = '42501'; end if;
  if p_codigo !~ '^[a-z0-9]{8,20}$' then raise exception 'codigo invalido' using errcode = '22023'; end if;
  if p_ruta !~ '^pedidos/[A-Za-z0-9._-]+\.pdf$' then raise exception 'ruta invalida' using errcode = '22023'; end if;
  insert into pedido_pdf_enlace (codigo, ruta, pedido_id, creado_por, expira_en)
  values (p_codigo, p_ruta, p_pedido_id, auth.uid(), now() + make_interval(days => greatest(1, least(coalesce(p_dias, 30), 90))));
  return p_codigo;
end
$fn$;
revoke all on function pedido_pdf_enlace_crear(bigint, text, text, int) from public, anon;
grant execute on function pedido_pdf_enlace_crear(bigint, text, text, int) to authenticated;
