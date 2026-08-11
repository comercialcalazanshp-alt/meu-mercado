-- Meu Mercado — v21.
-- Recibo digital: o cliente guarda o link do pedido e pode abrir/imprimir
-- depois. Pedido não tem policy pública de select (evitaria vazar todos os
-- pedidos da loja pra quem consultar sem filtro) — em vez disso, uma
-- função security definer devolve só o pedido cujo id exato o cliente já
-- tem em mãos, igual o padrão já usado em checkout()/track_site_visit().

create or replace function public.get_order_receipt(p_order_id uuid)
returns table (
  order_id uuid,
  store_name text,
  store_slug text,
  customer_name text,
  items jsonb,
  total numeric,
  discount numeric,
  coupon_code text,
  delivery_fee numeric,
  neighborhood_name text,
  cashback_earned numeric,
  cashback_used numeric,
  status text,
  channel text,
  payment_method text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.id,
    s.name,
    s.slug,
    o.customer_name,
    o.items,
    o.total,
    o.discount_amount,
    o.coupon_code,
    o.delivery_fee,
    o.neighborhood_name,
    o.cashback_earned,
    o.cashback_used,
    o.status,
    o.channel,
    o.payment_method,
    o.created_at
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.id = p_order_id;
$$;

grant execute on function public.get_order_receipt(uuid) to anon, authenticated;
