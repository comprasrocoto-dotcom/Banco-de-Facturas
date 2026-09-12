create sequence if not exists pedidos_web_seq start 1;

create or replace function siguiente_pedido() returns text
language sql security definer as
$$ select 'PED-' || lpad(nextval('pedidos_web_seq')::text, 4, '0') $$;

grant execute on function siguiente_pedido() to authenticated;
