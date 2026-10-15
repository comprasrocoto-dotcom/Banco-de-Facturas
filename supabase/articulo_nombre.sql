-- ============================================================
--  NOMBRE DEL ARTICULO EDITABLE EN ADMIN (15/10/2026, pedido del usuario)
-- ============================================================
-- Admin > Articulos > Editar ya cambia articulos.articulo_hiopos (y el comercial si era el mismo) o marca_articulo.articulo.
-- En "Nuevo pedido" el nombre de un articulo sale de los pedidos viejos a ese proveedor; con esta marca de fecha, el nombre que
-- el admin edito gana sobre ese historico. Solo aditivo: columna nueva y vacia (nada cambia hasta que se edite un nombre).
alter table articulos add column if not exists nombre_editado_en timestamptz;
