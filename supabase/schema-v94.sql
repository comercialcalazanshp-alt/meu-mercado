-- Meu Mercado — v94.
-- Achado na revisão de consumidor: o recibo de pedido de Hub (carrinho com
-- várias lojas) não tinha acompanhamento de entrega nem botão de "tive um
-- problema" — só o recibo de loja única tinha os dois. get_hub_order_receipt
-- (v80) não devolvia out_for_delivery_at nem os campos de pagamento por
-- PERNA (só os do hub_orders combinado, que nem sempre são preenchidos —
-- ver hub-order-payment-sync.ts, schema-v92). Adiciona esses campos —
-- CREATE OR REPLACE não permite mudar colunas de retorno, por isso o drop.
drop function if exists public.get_hub_order_receipt(uuid);

create function public.get_hub_order_receipt(p_hub_order_id uuid)
returns table (
  hub_order_id uuid,
  hub_store_name text,
  customer_name text,
  customer_phone text,
  hub_total numeric,
  payment_method text,
  pix_qr_code_text text,
  pix_qr_code_image text,
  pix_paid_at timestamptz,
  card_paid_at timestamptz,
  created_at timestamptz,
  order_id uuid,
  store_id uuid,
  store_name text,
  store_brand_color text,
  items jsonb,
  store_total numeric,
  discount numeric,
  delivery_fee numeric,
  neighborhood_name text,
  status text,
  eta_min_minutes int,
  eta_max_minutes int,
  out_for_delivery_at timestamptz,
  order_payment_method text,
  order_pix_paid_at timestamptz,
  order_card_paid_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ho.id, hs.name, ho.customer_name, ho.customer_phone, ho.total, ho.payment_method,
    ho.pix_qr_code_text, ho.pix_qr_code_image, ho.pix_paid_at, ho.card_paid_at, ho.created_at,
    o.id, o.store_id, s.name, s.brand_color, o.items, o.total, o.discount_amount, o.delivery_fee,
    o.neighborhood_name, o.status, o.eta_min_minutes, o.eta_max_minutes, o.out_for_delivery_at,
    o.payment_method, o.pix_paid_at, o.card_paid_at
  from public.hub_orders ho
  join public.stores hs on hs.id = ho.hub_store_id
  join public.orders o on o.hub_order_id = ho.id
  join public.stores s on s.id = o.store_id
  where ho.id = p_hub_order_id
  order by o.created_at asc;
$$;

grant execute on function public.get_hub_order_receipt(uuid) to anon, authenticated;
