-- Meu Mercado — v9.
-- Avaliação de produto: qualquer cliente pode avaliar um produto ativo da
-- loja (sem precisar de login, igual o resto da vitrine); o dono pode apagar
-- avaliação inadequada. Lista de compras compartilhável: o cliente monta o
-- carrinho e gera um link que abre o mesmo carrinho pra outra pessoa.

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  customer_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table reviews enable row level security;

drop policy if exists "avaliacoes sao publicas" on reviews;
create policy "avaliacoes sao publicas" on reviews for select
  using (true);

drop policy if exists "qualquer um avalia produto ativo" on reviews;
create policy "qualquer um avalia produto ativo" on reviews for insert
  with check (
    exists (
      select 1 from products p
      where p.id = reviews.product_id
        and p.store_id = reviews.store_id
        and p.active = true
    )
  );

drop policy if exists "dono modera avaliacoes da propria loja" on reviews;
create policy "dono modera avaliacoes da propria loja" on reviews for delete
  using (store_id in (select id from stores where owner_id = auth.uid()));

create table if not exists shared_lists (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);

alter table shared_lists enable row level security;

drop policy if exists "qualquer um cria lista compartilhada" on shared_lists;
create policy "qualquer um cria lista compartilhada" on shared_lists for insert
  with check (true);

drop policy if exists "lista compartilhada e publica" on shared_lists;
create policy "lista compartilhada e publica" on shared_lists for select
  using (true);
