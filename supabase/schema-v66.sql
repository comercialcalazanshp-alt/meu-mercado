-- Meu Mercado — v66.
-- Relatórios só mostravam receita bruta (soma dos pedidos) — sem descontar
-- o custo do que foi vendido nem as despesas do período, o dono não tinha
-- como saber quanto sobrou de verdade no mês. get_profit_summary calcula
-- receita, custo dos produtos/kits vendidos (mesma lógica de
-- product_sales_stats/kit_sales_stats já existentes) e despesas lançadas
-- no período, pra achar o lucro líquido. missing_cost avisa quando algum
-- item vendido não tem cost_price cadastrado — nesse caso o custo fica
-- subestimado, e o painel deve deixar isso claro em vez de fingir precisão.
create or replace function public.get_profit_summary(p_store_id uuid, p_since timestamptz, p_until timestamptz)
returns table (
  revenue numeric,
  cogs numeric,
  missing_cost boolean,
  expenses numeric,
  profit numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revenue numeric;
  v_cogs numeric;
  v_missing_cost boolean;
  v_expenses numeric;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  select coalesce(sum(o.total), 0)
    into v_revenue
    from public.orders o
    where o.store_id = p_store_id
      and o.status <> 'cancelado'
      and o.created_at >= p_since
      and o.created_at < p_until;

  with items as (
    select
      elem->>'product_id' as product_id,
      elem->>'kit_id' as kit_id,
      (elem->>'quantity')::numeric as qty
    from public.orders o, jsonb_array_elements(o.items) as elem
    where o.store_id = p_store_id
      and o.status <> 'cancelado'
      and o.created_at >= p_since
      and o.created_at < p_until
  ),
  product_lines as (
    select i.qty, p.cost_price
    from items i
    join public.products p on p.id = i.product_id::uuid
    where i.product_id is not null
  ),
  kit_unit_cost as (
    select ki.kit_id,
      case when bool_and(p.cost_price is not null) then sum(ki.quantity * p.cost_price) else null end as unit_cost
    from public.kit_items ki
    join public.products p on p.id = ki.product_id
    group by ki.kit_id
  ),
  kit_lines as (
    select i.qty, kuc.unit_cost as cost_price
    from items i
    left join kit_unit_cost kuc on kuc.kit_id = i.kit_id::uuid
    where i.kit_id is not null
  ),
  all_lines as (
    select qty, cost_price from product_lines
    union all
    select qty, cost_price from kit_lines
  )
  select coalesce(sum(qty * cost_price), 0), bool_or(cost_price is null)
    into v_cogs, v_missing_cost
    from all_lines;

  select coalesce(sum(e.amount), 0)
    into v_expenses
    from public.expenses e
    where e.store_id = p_store_id
      and e.expense_date >= p_since::date
      and e.expense_date < p_until::date;

  return query select
    v_revenue,
    v_cogs,
    coalesce(v_missing_cost, false),
    v_expenses,
    v_revenue - v_cogs - v_expenses;
end;
$$;
