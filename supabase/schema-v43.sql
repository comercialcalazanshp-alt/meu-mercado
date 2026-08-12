-- Caixa: resumo do dia ao vivo (enquanto o caixa está aberto), quem abriu/
-- fechou o caixa, e valor esperado mostrado antes de fechar.
alter table public.cash_sessions add column if not exists opened_by text default auth.email();
alter table public.cash_sessions add column if not exists closed_by text;

create or replace function public.cash_session_summary(p_session_id uuid)
returns table (orders_count int, revenue_total numeric, expected_cash numeric, revenue_by_payment jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_cash_sales numeric := 0;
  v_all_revenue numeric := 0;
  v_orders_count int := 0;
  v_reforco numeric := 0;
  v_sangria numeric := 0;
  v_revenue_by_payment jsonb;
begin
  select * into v_session from cash_sessions
    where id = p_session_id and store_id in (select public.my_store_ids());

  if not found then
    raise exception 'Sessão de caixa não encontrada';
  end if;

  select coalesce(sum(amt), 0) into v_cash_sales
  from (
    select total as amt from public.orders
    where store_id = v_session.store_id and payment_method = 'dinheiro'
      and created_at >= v_session.opened_at and status <> 'cancelado'
    union all
    select (elem->>'amount')::numeric as amt
    from public.orders o, jsonb_array_elements(o.payment_split) as elem
    where o.store_id = v_session.store_id and o.payment_method = 'dividido'
      and o.created_at >= v_session.opened_at and o.status <> 'cancelado'
      and elem->>'method' = 'dinheiro'
  ) t;

  select coalesce(sum(total), 0), count(*) into v_all_revenue, v_orders_count from orders
    where store_id = v_session.store_id and created_at >= v_session.opened_at and status <> 'cancelado';

  select coalesce(sum(amount), 0) into v_reforco
    from cash_movements where session_id = p_session_id and type = 'reforco';
  select coalesce(sum(amount), 0) into v_sangria
    from cash_movements where session_id = p_session_id and type = 'sangria';

  select jsonb_object_agg(payment_label, total) into v_revenue_by_payment
  from (
    select coalesce(pm, 'site/outro') as payment_label, sum(amt) as total
    from (
      select payment_method as pm, total as amt from public.orders
      where store_id = v_session.store_id and created_at >= v_session.opened_at
        and status <> 'cancelado' and payment_method <> 'dividido'
      union all
      select (elem->>'method') as pm, (elem->>'amount')::numeric as amt
      from public.orders o, jsonb_array_elements(o.payment_split) as elem
      where o.store_id = v_session.store_id and o.payment_method = 'dividido'
        and o.created_at >= v_session.opened_at and o.status <> 'cancelado'
    ) parts
    group by coalesce(pm, 'site/outro')
  ) t;

  return query select
    v_orders_count,
    v_all_revenue,
    v_session.opening_amount + v_cash_sales + v_reforco - v_sangria,
    coalesce(v_revenue_by_payment, '{}'::jsonb);
end;
$$;

create or replace function public.close_cash_session(p_session_id uuid, p_declared numeric)
returns table (expected_cash numeric, cash_difference numeric, revenue_total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_cash_sales numeric := 0;
  v_all_revenue numeric := 0;
  v_reforco numeric := 0;
  v_sangria numeric := 0;
  v_expected numeric;
  v_revenue_by_payment jsonb;
begin
  select * into v_session from cash_sessions
    where id = p_session_id and status = 'aberto'
      and store_id in (select public.my_store_ids())
    for update;

  if not found then
    raise exception 'Sessão de caixa não encontrada ou já fechada';
  end if;

  select coalesce(sum(amt), 0) into v_cash_sales
  from (
    select total as amt from public.orders
    where store_id = v_session.store_id and payment_method = 'dinheiro'
      and created_at >= v_session.opened_at and status <> 'cancelado'
    union all
    select (elem->>'amount')::numeric as amt
    from public.orders o, jsonb_array_elements(o.payment_split) as elem
    where o.store_id = v_session.store_id and o.payment_method = 'dividido'
      and o.created_at >= v_session.opened_at and o.status <> 'cancelado'
      and elem->>'method' = 'dinheiro'
  ) t;

  select coalesce(sum(total), 0) into v_all_revenue from orders
    where store_id = v_session.store_id and created_at >= v_session.opened_at and status <> 'cancelado';

  select coalesce(sum(amount), 0) into v_reforco
    from cash_movements where session_id = p_session_id and type = 'reforco';
  select coalesce(sum(amount), 0) into v_sangria
    from cash_movements where session_id = p_session_id and type = 'sangria';

  v_expected := v_session.opening_amount + v_cash_sales + v_reforco - v_sangria;

  select jsonb_object_agg(payment_label, total) into v_revenue_by_payment
  from (
    select coalesce(pm, 'site/outro') as payment_label, sum(amt) as total
    from (
      select payment_method as pm, total as amt from public.orders
      where store_id = v_session.store_id and created_at >= v_session.opened_at
        and status <> 'cancelado' and payment_method <> 'dividido'
      union all
      select (elem->>'method') as pm, (elem->>'amount')::numeric as amt
      from public.orders o, jsonb_array_elements(o.payment_split) as elem
      where o.store_id = v_session.store_id and o.payment_method = 'dividido'
        and o.created_at >= v_session.opened_at and o.status <> 'cancelado'
    ) parts
    group by coalesce(pm, 'site/outro')
  ) t;

  update cash_sessions set
    closed_at = now(),
    closing_amount_declared = p_declared,
    expected_cash = v_expected,
    cash_difference = p_declared - v_expected,
    revenue_total = v_all_revenue,
    revenue_by_payment = coalesce(v_revenue_by_payment, '{}'::jsonb),
    status = 'fechado',
    closed_by = auth.email()
  where id = p_session_id;

  return query select v_expected, p_declared - v_expected, v_all_revenue;
end;
$$;
