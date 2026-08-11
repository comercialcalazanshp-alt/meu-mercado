-- Meu Mercado — v24.
-- Módulo Caixa: abrir com um valor inicial, registrar sangria/reforço
-- durante o dia, fechar contando o dinheiro de verdade e comparando com o
-- esperado (inicial + vendas em dinheiro do PDV + reforços − sangrias).
-- Só considera "dinheiro" as vendas do PDV com essa forma de pagamento —
-- pedidos do site ainda não têm forma de pagamento registrada (não tem
-- cobrança online ainda), então entram como "site/outro" no resumo.

create table if not exists cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  opening_amount numeric not null,
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closing_amount_declared numeric,
  expected_cash numeric,
  cash_difference numeric,
  revenue_total numeric,
  revenue_by_payment jsonb
);

alter table cash_sessions enable row level security;

drop policy if exists "dono gerencia caixa da propria loja" on cash_sessions;
create policy "dono gerencia caixa da propria loja" on cash_sessions for all
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

create table if not exists cash_movements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references cash_sessions(id) on delete cascade not null,
  type text not null check (type in ('sangria', 'reforco')),
  amount numeric not null,
  description text,
  created_at timestamptz not null default now()
);

alter table cash_movements enable row level security;

drop policy if exists "dono gerencia movimentos da propria loja" on cash_movements;
create policy "dono gerencia movimentos da propria loja" on cash_movements for all
  using (session_id in (
    select id from cash_sessions where store_id in (select id from stores where owner_id = auth.uid())
  ))
  with check (session_id in (
    select id from cash_sessions where store_id in (select id from stores where owner_id = auth.uid())
  ));

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
      and store_id in (select id from stores where owner_id = auth.uid())
    for update;

  if not found then
    raise exception 'Sessão de caixa não encontrada ou já fechada';
  end if;

  select coalesce(sum(total), 0) into v_cash_sales from orders
    where store_id = v_session.store_id and payment_method = 'dinheiro'
      and created_at >= v_session.opened_at and status <> 'cancelado';

  select coalesce(sum(total), 0) into v_all_revenue from orders
    where store_id = v_session.store_id and created_at >= v_session.opened_at and status <> 'cancelado';

  select coalesce(sum(amount), 0) into v_reforco
    from cash_movements where session_id = p_session_id and type = 'reforco';
  select coalesce(sum(amount), 0) into v_sangria
    from cash_movements where session_id = p_session_id and type = 'sangria';

  v_expected := v_session.opening_amount + v_cash_sales + v_reforco - v_sangria;

  select jsonb_object_agg(payment_label, total) into v_revenue_by_payment
  from (
    select coalesce(payment_method, 'site/outro') as payment_label, sum(total) as total
    from orders
    where store_id = v_session.store_id and created_at >= v_session.opened_at and status <> 'cancelado'
    group by coalesce(payment_method, 'site/outro')
  ) t;

  update cash_sessions set
    closed_at = now(),
    closing_amount_declared = p_declared,
    expected_cash = v_expected,
    cash_difference = p_declared - v_expected,
    revenue_total = v_all_revenue,
    revenue_by_payment = coalesce(v_revenue_by_payment, '{}'::jsonb),
    status = 'fechado'
  where id = p_session_id;

  return query select v_expected, p_declared - v_expected, v_all_revenue;
end;
$$;

grant execute on function public.close_cash_session(uuid, numeric) to authenticated;
