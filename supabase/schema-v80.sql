-- Meu Mercado — v80.
-- Vitrine em módulos do Hub: o hub (loja com afiliados ativos) passa a
-- mostrar o catálogo de cada afiliado como um módulo colorido na mesma
-- página, e o cliente monta UM carrinho só cruzando hub + afiliados,
-- fechando tudo num checkout único.
--
-- Por baixo, "um checkout único" continua criando um pedido (orders)
-- SEPARADO por loja envolvida — reaproveitando 100% da função checkout()
-- já existente e confiável (preço/estoque revalidados no servidor, cupom,
-- cashback, scratch card, referência) — só que chamada uma vez por loja
-- dentro de UMA transação (se der erro numa loja, tudo é desfeito, nenhum
-- estoque fica descontado pela metade). hub_orders é o "pedido-guarda-
-- chuva" que agrupa esses pedidos e guarda o total combinado + o
-- pagamento único (Pix/cartão, cobrado uma vez só do hub — o repasse pra
-- cada afiliado continua pelo saldo em Afiliados, que esta migração passa
-- a alimentar de verdade a partir de vendas reais).
--
-- Fora de escopo aqui (fica pro backlog): split automático de pagamento
-- de verdade entre contas bancárias diferentes (PagBank Split) e rota de
-- entrega centralizada com otimização — o afiliate_order_stops criado em
-- v73 só é populado aqui como checklist simples de retirada por loja.

-- ============================================================
-- PARTE 1 — hub_orders
-- ============================================================

create table if not exists public.hub_orders (
  id uuid primary key default gen_random_uuid(),
  hub_store_id uuid references public.stores(id) on delete cascade not null,
  customer_name text not null,
  customer_phone text not null,
  total numeric not null default 0,
  payment_method text,
  pix_qr_code_text text,
  pix_qr_code_image text,
  pix_paid_at timestamptz,
  pagbank_order_id text,
  card_paid_at timestamptz,
  card_last_digits text,
  card_brand text,
  created_at timestamptz not null default now()
);

create index if not exists idx_hub_orders_hub_store on public.hub_orders (hub_store_id, created_at desc);

alter table public.orders add column if not exists hub_order_id uuid references public.hub_orders(id) on delete cascade;
create index if not exists idx_orders_hub_order on public.orders (hub_order_id);

alter table public.hub_orders enable row level security;

-- Sem policy pública de insert/update de propósito — igual orders, quem
-- cria/atualiza é sempre uma função security definer (checkout_hub) ou a
-- rota de pagamento (usa a service role, que ignora RLS). O dono só lê.
drop policy if exists "dono do hub ve seus pedidos combinados" on public.hub_orders;
create policy "dono do hub ve seus pedidos combinados" on public.hub_orders for select
  using (hub_store_id in (select public.my_store_ids()));

-- ============================================================
-- PARTE 2 — checkout_hub()
-- ============================================================

-- p_carts: um array com um item por loja presente no carrinho, ex:
-- [{ "store_id": "...", "items": [...mesmo formato de checkout()...],
--    "coupon_code": "...", "neighborhood_id": "...", "delivery_address": "..." }]
--
-- O código de indicação (referral) só é aplicado na primeira loja do
-- carrinho, nunca em todas — passar o mesmo código pra cada chamada de
-- checkout() multiplicaria o bônus de indicação por loja, o que não faz
-- sentido (é uma indicação só, não uma por módulo comprado).
create or replace function public.checkout_hub(
  p_hub_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_carts jsonb,
  p_use_cashback boolean default false,
  p_birthday date default null,
  p_referral_code text default null
)
returns table (
  hub_order_id uuid,
  store_id uuid,
  order_id uuid,
  total numeric,
  discount numeric,
  delivery_fee numeric,
  eta_min_minutes int,
  eta_max_minutes int
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hub_order_id uuid;
  v_cart jsonb;
  v_store_id uuid;
  v_result record;
  v_is_first boolean := true;
begin
  if p_customer_name is null or trim(p_customer_name) = '' then
    raise exception 'Nome do cliente é obrigatório';
  end if;
  if p_customer_phone is null or trim(p_customer_phone) = '' then
    raise exception 'WhatsApp do cliente é obrigatório';
  end if;
  if p_carts is null or jsonb_array_length(p_carts) = 0 then
    raise exception 'Carrinho vazio';
  end if;

  if not exists (select 1 from public.stores where id = p_hub_store_id) then
    raise exception 'Loja não encontrada';
  end if;

  insert into public.hub_orders (hub_store_id, customer_name, customer_phone)
  values (p_hub_store_id, trim(p_customer_name), trim(p_customer_phone))
  returning id into v_hub_order_id;

  for v_cart in select * from jsonb_array_elements(p_carts)
  loop
    v_store_id := (v_cart->>'store_id')::uuid;

    -- confere que a loja do carrinho é de fato o hub ou um afiliado ATIVO
    -- dele — impede montar um carrinho apontando pra uma loja qualquer da
    -- plataforma sem relação com esse hub.
    if v_store_id <> p_hub_store_id and not exists (
      select 1 from public.affiliate_partnerships ap
      where ap.hub_store_id = p_hub_store_id and ap.module_store_id = v_store_id and ap.active
    ) then
      raise exception 'Uma das lojas do carrinho não pertence a este hub';
    end if;

    select * into v_result from public.checkout(
      v_store_id,
      p_customer_name,
      p_customer_phone,
      v_cart->'items',
      v_cart->>'coupon_code',
      case when v_is_first then p_referral_code else null end,
      p_use_cashback,
      p_birthday,
      nullif(v_cart->>'neighborhood_id', '')::uuid,
      v_cart->>'delivery_address',
      null
    );
    v_is_first := false;

    update public.orders set hub_order_id = v_hub_order_id where id = v_result.order_id;

    -- repasse pro afiliado: o valor do 'venda' é o que SOBRA pro afiliado
    -- depois da comissão do hub — total * (100 - comissão%) / 100. Confirmado
    -- lendo o gatilho que soma esse valor ao saldo (apply_affiliate_settlement_transaction,
    -- schema-v73) e como o Dashboard já deriva a comissão do hub a partir
    -- desse mesmo valor — errar o lado da conta seria um bug de dinheiro real.
    insert into public.affiliate_settlement_transactions (partnership_id, type, amount, order_id, note)
    select ap.id, 'venda', round(v_result.total * (100 - ap.commission_percent) / 100, 2), v_result.order_id,
      'Venda via vitrine do hub'
    from public.affiliate_partnerships ap
    where ap.hub_store_id = p_hub_store_id
      and ap.module_store_id = v_store_id
      and ap.active
      and round(v_result.total * (100 - ap.commission_percent) / 100, 2) > 0;

    -- checklist de retirada por loja envolvida no pedido (só quando a loja
    -- tem endereço cadastrado).
    insert into public.affiliate_order_stops (order_id, store_id, address, lat, lng)
    select v_result.order_id, s.id, s.address, s.lat, s.lng
    from public.stores s
    where s.id = v_store_id and s.address is not null and trim(s.address) <> '';

    return query select v_hub_order_id, v_store_id, v_result.order_id, v_result.total,
      v_result.discount, v_result.delivery_fee, v_result.eta_min_minutes, v_result.eta_max_minutes;
  end loop;

  update public.hub_orders
  set total = (select coalesce(sum(o.total), 0) from public.orders o where o.hub_order_id = v_hub_order_id)
  where id = v_hub_order_id;
end;
$$;

grant execute on function public.checkout_hub(uuid, text, text, jsonb, boolean, date, text) to anon, authenticated;

-- ============================================================
-- PARTE 3 — get_hub_modules()
-- ============================================================

-- affiliate_partnerships tem CPF/CNPJ, chave Pix, comissão e endereço — RLS
-- só deixa o dono do hub e o próprio afiliado lerem essa tabela. A vitrine
-- pública precisa saber quais afiliados existem (pra montar os módulos),
-- mas SEM nenhum desses dados sensíveis — por isso essa função devolve só
-- o que é seguro mostrar pra qualquer visitante (nome/cor/categoria).
create or replace function public.get_hub_modules(p_hub_store_id uuid)
returns table (
  partnership_id uuid,
  category text,
  store_id uuid,
  store_slug text,
  store_name text,
  brand_color text,
  accent_color text
)
language sql
security definer
set search_path = public
stable
as $$
  select ap.id, ap.category, s.id, s.slug, s.name, s.brand_color, s.accent_color
  from public.affiliate_partnerships ap
  join public.stores s on s.id = ap.module_store_id
  where ap.hub_store_id = p_hub_store_id and ap.active and s.active
  order by ap.category asc;
$$;

grant execute on function public.get_hub_modules(uuid) to anon, authenticated;

-- ============================================================
-- PARTE 4 — get_hub_order_receipt()
-- ============================================================

-- Devolve uma linha por loja envolvida no pedido combinado, pro cliente
-- ver o resumo completo discriminado (nunca um total escondido) na tela
-- de confirmação e no recibo.
create or replace function public.get_hub_order_receipt(p_hub_order_id uuid)
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
  eta_max_minutes int
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
    o.neighborhood_name, o.status, o.eta_min_minutes, o.eta_max_minutes
  from public.hub_orders ho
  join public.stores hs on hs.id = ho.hub_store_id
  join public.orders o on o.hub_order_id = ho.id
  join public.stores s on s.id = o.store_id
  where ho.id = p_hub_order_id
  order by o.created_at asc;
$$;

grant execute on function public.get_hub_order_receipt(uuid) to anon, authenticated;
