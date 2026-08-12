-- Produtos: movimentações de estoque (compra ligada a despesa, perda/quebra),
-- estatística de venda por produto (velocidade, parado, lucro) e reajuste de
-- preço em massa por categoria.

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  product_id uuid references public.products(id) on delete cascade not null,
  type text not null check (type in ('compra', 'perda', 'quebra', 'outro')),
  quantity numeric not null check (quantity > 0),
  unit_cost numeric,
  note text,
  created_by text default auth.email(),
  created_at timestamptz not null default now()
);

alter table public.stock_movements enable row level security;

drop policy if exists "dono ve movimentos da propria loja" on public.stock_movements;
create policy "dono ve movimentos da propria loja" on public.stock_movements for select
  using (store_id in (select public.my_store_ids()));

alter table public.expenses add column if not exists stock_movement_id uuid references public.stock_movements(id) on delete set null;

-- Registra uma compra de mercadoria: cria a despesa, cria a movimentação de
-- estoque e já soma no estoque do produto, recalculando o custo médio
-- ponderado (se o produto já tinha estoque com custo conhecido).
create or replace function public.register_stock_purchase(
  p_store_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_total_cost numeric,
  p_description text default null,
  p_category text default 'fornecedores',
  p_expense_date date default current_date
)
returns table (expense_id uuid, movement_id uuid, new_stock numeric, new_cost_price numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_unit_cost numeric;
  v_new_cost numeric;
  v_new_stock numeric;
  v_expense_id uuid;
  v_movement_id uuid;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantidade inválida';
  end if;

  if p_total_cost is null or p_total_cost <= 0 then
    raise exception 'Valor total inválido';
  end if;

  select id, name, stock, cost_price into v_product
  from public.products
  where id = p_product_id and store_id = p_store_id
  for update;

  if not found then
    raise exception 'Produto não encontrado';
  end if;

  v_unit_cost := p_total_cost / p_quantity;
  v_new_stock := v_product.stock + p_quantity;

  if v_product.cost_price is null or v_product.stock <= 0 then
    v_new_cost := v_unit_cost;
  else
    v_new_cost := round(((v_product.stock * v_product.cost_price) + (p_quantity * v_unit_cost)) / v_new_stock, 4);
  end if;

  update public.products set stock = v_new_stock, cost_price = v_new_cost where id = v_product.id;

  insert into public.stock_movements (store_id, product_id, type, quantity, unit_cost, note)
  values (p_store_id, v_product.id, 'compra', p_quantity, v_unit_cost, p_description)
  returning id into v_movement_id;

  insert into public.expenses (store_id, description, category, amount, expense_date, stock_movement_id)
  values (
    p_store_id,
    coalesce(nullif(trim(p_description), ''), 'Compra de ' || v_product.name),
    coalesce(p_category, 'fornecedores'),
    p_total_cost,
    p_expense_date,
    v_movement_id
  )
  returning id into v_expense_id;

  return query select v_expense_id, v_movement_id, v_new_stock, v_new_cost;
end;
$$;

-- Baixa de estoque por perda, quebra ou outro motivo (não é venda).
create or replace function public.register_stock_loss(
  p_store_id uuid,
  p_product_id uuid,
  p_type text,
  p_quantity numeric,
  p_note text default null
)
returns table (movement_id uuid, new_stock numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_new_stock numeric;
  v_movement_id uuid;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  if p_type not in ('perda', 'quebra', 'outro') then
    raise exception 'Tipo de baixa inválido';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantidade inválida';
  end if;

  select id, stock into v_product
  from public.products
  where id = p_product_id and store_id = p_store_id
  for update;

  if not found then
    raise exception 'Produto não encontrado';
  end if;

  if v_product.stock < p_quantity then
    raise exception 'Não tem estoque suficiente pra essa baixa: tem % e pediu %', v_product.stock, p_quantity;
  end if;

  v_new_stock := v_product.stock - p_quantity;
  update public.products set stock = v_new_stock where id = v_product.id;

  v_movement_id := gen_random_uuid();
  insert into public.stock_movements (id, store_id, product_id, type, quantity, note)
  values (v_movement_id, p_store_id, v_product.id, p_type, p_quantity, p_note);

  return query select v_movement_id, v_new_stock;
end;
$$;

-- Estatística de venda por produto: quanto vendeu e lucrou nos últimos N
-- dias, a que ritmo (unidades/dia) e quando foi a última venda (pra achar
-- produto parado). Ignora linhas de kit (que não têm product_id).
create or replace function public.product_sales_stats(p_store_id uuid, p_days int default 30)
returns table (
  product_id uuid,
  units_sold_recent numeric,
  revenue_recent numeric,
  profit_recent numeric,
  avg_daily_sales numeric,
  last_sold_at timestamptz
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
  with items as (
    select
      (elem->>'product_id')::uuid as pid,
      (elem->>'quantity')::numeric as qty,
      coalesce(
        (elem->>'line_total')::numeric,
        (elem->>'price')::numeric * (elem->>'quantity')::numeric
      ) as line_revenue,
      o.created_at
    from public.orders o, jsonb_array_elements(o.items) as elem
    where o.store_id = p_store_id
      and o.status <> 'cancelado'
      and elem ? 'product_id'
  ),
  recent as (
    select pid, sum(qty) as units, sum(line_revenue) as revenue
    from items
    where created_at >= now() - (greatest(p_days, 1) || ' days')::interval
    group by pid
  ),
  last_sale as (
    select pid, max(created_at) as last_at
    from items
    group by pid
  )
  select
    p.id,
    coalesce(recent.units, 0),
    coalesce(recent.revenue, 0),
    case when p.cost_price is not null
      then coalesce(recent.revenue, 0) - coalesce(recent.units, 0) * p.cost_price
      else null
    end,
    round(coalesce(recent.units, 0) / greatest(p_days, 1), 3),
    last_sale.last_at
  from public.products p
  left join recent on recent.pid = p.id
  left join last_sale on last_sale.pid = p.id
  where p.store_id = p_store_id;
end;
$$;

-- Reajuste de preço em massa, opcionalmente restrito a uma categoria.
create or replace function public.bulk_price_adjust(p_store_id uuid, p_percent numeric, p_category text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  if p_percent is null or p_percent = 0 then
    raise exception 'Informe uma porcentagem diferente de zero';
  end if;

  update public.products
  set price = greatest(round(price * (1 + p_percent / 100.0), 2), 0.01)
  where store_id = p_store_id
    and (p_category is null or category = p_category);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
