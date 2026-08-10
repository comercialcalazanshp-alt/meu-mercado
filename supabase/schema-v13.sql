-- Meu Mercado — v13.
-- Operacional: preço de custo (pra calcular margem) e contas/despesas da
-- loja (aluguel, fornecedor, energia etc.), pra saber o que sobra de
-- verdade além do total de vendas.

alter table products add column if not exists cost_price numeric;

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  description text not null,
  category text not null default 'outros',
  amount numeric not null check (amount > 0),
  expense_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table expenses enable row level security;

drop policy if exists "dono gerencia despesas da propria loja" on expenses;
create policy "dono gerencia despesas da propria loja" on expenses for all
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));
