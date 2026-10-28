-- ============================================================
--  RENDIMIENTO DE LAS REGLAS DE SEGURIDAD (RLS)  -  28/10/2026, pedido del usuario: «la web se está demorando mucho»
-- ============================================================
-- Las reglas llamaban mi_rol() / mi_sede() / mi_marca() FILA POR FILA (cada llamada consulta perfiles): con 3.700 facturas, 3.300
-- novedades y 11.000 lineas de pedido, cada pantalla hacia decenas de miles de consultas. Envolver la llamada en (SELECT ...) hace que
-- Postgres la calcule UNA vez por consulta (mismo resultado: son funciones estables de la sesion).
-- Medido como analista: facturas 2.765 ms -> 15 ms por bloque de 1.000; novedades 6.163 -> 869 ms; pedidos 292 -> 5 ms.
-- Probado antes con un bloque que se revierte: mismos conteos visibles en 8 tablas para admin, los 5 de pagos y 4 sedes.
-- No cambia QUIEN ve QUE: solo reescribe el texto de las 83 reglas que usaban esas funciones. Repetirlo no hace nada (ya envueltas).
do $$ declare r record; q text; w text; begin
  set local lock_timeout = '3s';
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(?<!SELECT )(mi_rol|mi_sede|mi_marca)\(\)'
            order by tablename, policyname loop
    q := r.qual; w := r.with_check;
    if q is not null then q := regexp_replace(q, '(?<!SELECT )(mi_rol|mi_sede|mi_marca)\(\)', '( SELECT \1() AS \1)', 'g'); end if;
    if w is not null then w := regexp_replace(w, '(?<!SELECT )(mi_rol|mi_sede|mi_marca)\(\)', '( SELECT \1() AS \1)', 'g'); end if;
    execute format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename)
      || case when q is not null then ' using (' || q || ')' else '' end
      || case when w is not null then ' with check (' || w || ')' else '' end;
  end loop;
end $$;
