-- Meu Mercado — v113.
-- A vitrine do Hub não tinha conta de cliente de verdade — sem login,
-- cashback, indicação nem histórico de pedido (a loja única já tinha
-- tudo isso). Cashback e código de indicação são por loja (cada módulo
-- tem seu próprio "customers"), então no Hub isso vira um resumo por
-- loja em vez de um valor só. Pedido feito pelo Hub sempre gera um
-- hub_orders (checkout_hub, v92) — por isso o histórico agrupa por
-- hub_order_id, não por pedido individual.
create or replace function public.get_hub_customer_summary(p_hub_store_id uuid)
returns table (
  store_id uuid,
  store_name text,
  brand_color text,
  cashback_balance numeric,
  referral_code text
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  return query
  select s.id, s.name, s.brand_color, c.cashback_balance, c.referral_code
  from public.customers c
  join public.stores s on s.id = c.store_id
  where c.profile_id = auth.uid()
    and (
      s.id = p_hub_store_id
      or s.id in (
        select ap.module_store_id from public.affiliate_partnerships ap
        where ap.hub_store_id = p_hub_store_id and ap.active
      )
    );
end;
$$;

grant execute on function public.get_hub_customer_summary(uuid) to authenticated;

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
  order by o.created_at desc
  limit 100;
end;
$$;

grant execute on function public.get_customer_hub_orders(uuid) to authenticated;
