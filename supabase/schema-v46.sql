-- Meu Mercado — v46.
-- Parceiros/influenciadores: cada um tem um cupom próprio, e a loja paga
-- comissão sobre as vendas feitas com esse cupom. Guarda o histórico de
-- pagamentos de comissão já feitos, pra saber sempre quanto ainda deve.

create table if not exists public.influencers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  name text not null,
  phone text,
  commission_percent numeric not null default 0 check (commission_percent >= 0 and commission_percent <= 100),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.influencers enable row level security;

drop policy if exists "dono gerencia parceiros da propria loja" on public.influencers;
create policy "dono gerencia parceiros da propria loja" on public.influencers for all
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter table public.coupons add column if not exists influencer_id uuid references public.influencers(id) on delete set null;

create table if not exists public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid references public.influencers(id) on delete cascade not null,
  store_id uuid references public.stores(id) on delete cascade not null,
  amount numeric not null check (amount > 0),
  note text,
  paid_at date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.commission_payments enable row level security;

drop policy if exists "dono gerencia pagamentos de comissao da propria loja" on public.commission_payments;
create policy "dono gerencia pagamentos de comissao da propria loja" on public.commission_payments for all
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

-- Resumo por parceiro: quanto de venda o(s) cupom(ns) dele geraram, quanto
-- de comissão isso dá, quanto já foi pago, e quanto ainda falta pagar.
create or replace function public.influencer_report(p_store_id uuid)
returns table (
  influencer_id uuid,
  name text,
  phone text,
  commission_percent numeric,
  active boolean,
  coupon_codes text[],
  orders_count bigint,
  revenue_generated numeric,
  discount_given numeric,
  commission_owed numeric,
  total_paid numeric,
  balance_due numeric,
  last_order_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  return query
  with inf_coupons as (
    select i.id as inf_id, array_remove(array_agg(c.code), null) as codes
    from public.influencers i
    left join public.coupons c on c.influencer_id = i.id
    where i.store_id = p_store_id
    group by i.id
  ),
  order_stats as (
    select c.influencer_id as inf_id,
      count(o.id) as orders_count,
      coalesce(sum(o.total), 0) as revenue,
      coalesce(sum(o.discount_amount), 0) as discount,
      max(o.created_at) as last_order
    from public.coupons c
    join public.orders o on o.store_id = c.store_id and lower(o.coupon_code) = lower(c.code)
    where c.store_id = p_store_id and c.influencer_id is not null and o.status <> 'cancelado'
    group by c.influencer_id
  ),
  payments as (
    select cp.influencer_id as inf_id, coalesce(sum(cp.amount), 0) as paid
    from public.commission_payments cp
    where cp.store_id = p_store_id
    group by cp.influencer_id
  )
  select
    i.id,
    i.name,
    i.phone,
    i.commission_percent,
    i.active,
    coalesce(ic.codes, array[]::text[]),
    coalesce(os.orders_count, 0),
    coalesce(os.revenue, 0),
    coalesce(os.discount, 0),
    round(coalesce(os.revenue, 0) * i.commission_percent / 100, 2),
    coalesce(p.paid, 0),
    round(coalesce(os.revenue, 0) * i.commission_percent / 100, 2) - coalesce(p.paid, 0),
    os.last_order
  from public.influencers i
  left join inf_coupons ic on ic.inf_id = i.id
  left join order_stats os on os.inf_id = i.id
  left join payments p on p.inf_id = i.id
  where i.store_id = p_store_id
  order by i.name;
end;
$$;

-- Detalhe: cada pedido que usou algum cupom desse parceiro, com a comissão
-- calculada pedido a pedido.
create or replace function public.influencer_orders(p_store_id uuid, p_influencer_id uuid)
returns table (
  order_id uuid,
  customer_name text,
  customer_phone text,
  coupon_code text,
  total numeric,
  discount_amount numeric,
  commission numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_percent numeric;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  select commission_percent into v_percent
  from public.influencers
  where id = p_influencer_id and store_id = p_store_id;

  if not found then
    raise exception 'Parceiro não encontrado';
  end if;

  return query
  select o.id, o.customer_name, o.customer_phone, o.coupon_code, o.total, o.discount_amount,
    round(o.total * v_percent / 100, 2), o.created_at
  from public.orders o
  join public.coupons c on c.store_id = o.store_id and lower(c.code) = lower(o.coupon_code)
  where o.store_id = p_store_id and c.influencer_id = p_influencer_id and o.status <> 'cancelado'
  order by o.created_at desc;
end;
$$;
