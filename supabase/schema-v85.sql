-- Meu Mercado — v85.
-- get_hub_orders (v84) devolvia os pedidos do marketplace inteiro, mas sem
-- dizer de qual loja cada um era — o Início somava o total de todo pedido
-- como se fosse faturamento da Hub, quando na verdade ela só ganha a
-- comissão sobre venda de afiliado (o resto é dinheiro do afiliado, não
-- dela). Adiciona store_id no retorno pra o front conseguir separar:
-- pedido da própria Hub conta o valor inteiro, pedido de afiliado conta só
-- a comissão. CREATE OR REPLACE não permite mudar as colunas do retorno de
-- uma returns table, por isso o drop antes de recriar (mesmo caso da v82).

drop function if exists public.get_hub_orders(uuid, timestamptz);

create function public.get_hub_orders(
  p_hub_store_id uuid,
  p_since timestamptz
)
returns table (
  id uuid,
  store_id uuid,
  total numeric,
  status text,
  created_at timestamptz,
  customer_phone text
)
language sql
security definer
set search_path = public
stable
as $$
  with hub_stores as (
    select p_hub_store_id as id
    union
    select ap.module_store_id from public.affiliate_partnerships ap
    where ap.hub_store_id = p_hub_store_id and ap.active
  )
  select o.id, o.store_id, o.total, o.status, o.created_at, o.customer_phone
  from public.orders o
  join hub_stores hs on hs.id = o.store_id
  where o.created_at >= p_since
  order by o.created_at asc;
$$;

grant execute on function public.get_hub_orders(uuid, timestamptz) to authenticated;
