-- Meu Mercado — v121.
-- CORREÇÃO: get_customer_hub_orders (v113) trazia TODO pedido do cliente
-- nas lojas do hub, incluindo compras feitas direto na vitrine própria de
-- um afiliado (fora do carrinho combinado do Hub) — essas não têm
-- hub_order_id. No front, os pedidos são agrupados num Map por
-- hub_order_id, e Map trata "null" como uma chave só — então todo pedido
-- direto de um cliente num afiliado virava um único card falso, somando
-- totais e datas de compras completamente diferentes. Corrige trazendo só
-- pedidos que de fato passaram pelo checkout combinado do Hub.
create or replace function public.get_customer_hub_orders(p_hub_store_id uuid)
returns table (
  order_id uuid,
  hub_order_id uuid,
  store_id uuid,
  store_name text,
  items jsonb,
  total numeric,
  status text,
  created_at timestamptz,
  cashback_earned numeric,
  payment_method text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer_ids uuid[];
begin
  if auth.uid() is null then
    return;
  end if;

  select array_agg(c.id) into v_customer_ids
  from public.customers c
  where c.profile_id = auth.uid()
    and (
      c.store_id = p_hub_store_id
      or c.store_id in (
        select ap.module_store_id from public.affiliate_partnerships ap
        where ap.hub_store_id = p_hub_store_id and ap.active
      )
    );

  if v_customer_ids is null then
    return;
  end if;

  return query
  select o.id, o.hub_order_id, o.store_id, s.name, o.items, o.total, o.status, o.created_at, o.cashback_earned, o.payment_method
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.customer_id = any(v_customer_ids)
    and o.hub_order_id is not null
  order by o.created_at desc
  limit 100;
end;
$$;

grant execute on function public.get_customer_hub_orders(uuid) to authenticated;
