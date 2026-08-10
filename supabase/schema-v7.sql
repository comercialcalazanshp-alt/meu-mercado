-- Meu Mercado — v7.
-- Fiado/crediário: o dono registra uma venda fiada pro cliente (identificado
-- pelo telefone) e depois registra os pagamentos. O saldo devedor fica
-- guardado em credit_customers.balance, mantido automaticamente por um
-- gatilho toda vez que uma transação (venda ou pagamento) é inserida — nunca
-- calculado à mão no navegador, pra não desincronizar.

create table if not exists credit_customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  name text not null,
  phone text not null,
  balance numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (store_id, phone)
);

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references credit_customers(id) on delete cascade not null,
  type text not null check (type in ('venda', 'pagamento')),
  amount numeric not null check (amount > 0),
  note text,
  created_at timestamptz not null default now()
);

alter table credit_customers enable row level security;
alter table credit_transactions enable row level security;

drop policy if exists "dono gerencia clientes fiado da propria loja" on credit_customers;
create policy "dono gerencia clientes fiado da propria loja" on credit_customers for all
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

drop policy if exists "dono gerencia transacoes fiado da propria loja" on credit_transactions;
create policy "dono gerencia transacoes fiado da propria loja" on credit_transactions for all
  using (customer_id in (
    select cc.id from credit_customers cc
    join stores s on s.id = cc.store_id
    where s.owner_id = auth.uid()
  ))
  with check (customer_id in (
    select cc.id from credit_customers cc
    join stores s on s.id = cc.store_id
    where s.owner_id = auth.uid()
  ));

-- Mantém o saldo do cliente sempre igual à soma das transações — sem essa
-- trava, um "venda" e um "pagamento" inseridos quase juntos (duas abas, dois
-- cliques) poderiam competir e deixar o saldo errado.
create or replace function public.apply_credit_transaction()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'venda' then
    update credit_customers set balance = balance + new.amount where id = new.customer_id;
  else
    update credit_customers set balance = balance - new.amount where id = new.customer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_credit_transaction_insert on credit_transactions;
create trigger on_credit_transaction_insert
  after insert on credit_transactions
  for each row execute function public.apply_credit_transaction();
