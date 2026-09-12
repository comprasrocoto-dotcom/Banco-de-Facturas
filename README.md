# Banco de Facturas

Web para los puntos de venta: cada sede ve las facturas de su marca, las toma ("es mía"),
las sella y aprueba (requisito para pasar a pagos) y registra novedades.

- Solo se muestran documentos de **insumos, material de empaque, aseo, loza y utensilios**
- **Facturas** y **notas crédito** van separadas
- La **CUFE** es llave única: una factura no se puede duplicar
- Cada sede ve **solo lo suyo** + el pool de su marca (Row Level Security)

## Stack
Supabase (base + storage + login) · GitHub (código) · Vercel (publicación)

## Archivos
- `index.html` — la aplicación (un solo archivo, sin build)
- `vercel.json` — configuración de Vercel
- `supabase/schema.sql` — esquema de la base (idempotente: se puede correr varias veces)

## Llaves
Van en `.env.local`, que **no** se sube a GitHub.
La llave **publishable** sí vive en `index.html` porque es pública por diseño (RLS la protege).
La llave **secret** es solo del servidor (crear usuarios, subir PDF): jamás en el navegador.
