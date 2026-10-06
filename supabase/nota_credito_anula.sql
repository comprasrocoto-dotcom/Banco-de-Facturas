-- ============================================================
--  NOTA CREDITO QUE ANULA SU FACTURA  -  06/10/2026
--  El agente lee el PDF de cada nota credito (tabla "Referencias" y "Notas Finales" de la representacion grafica de la DIAN)
--  y la amarra sola a su factura. Si la nota dice que ANULA la factura, el amarre queda con anula = true y el agente
--  NO ingresa esa factura sola al ERP (factura + nota o ninguna).
--  SOLO AGREGA una columna con valor por defecto: los amarres que ya existen quedan igual (anula = false).
-- ============================================================
alter table nota_credito_factura add column if not exists anula boolean not null default false;
