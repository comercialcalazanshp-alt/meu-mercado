-- Meu Mercado — v28.
-- Receitas: o dono cadastra uma receita usando produtos que já vende — o
-- cliente vê no site e adiciona todos os ingredientes no carrinho com 1
-- clique. Marcar como "destaque" faz ela virar a "receita da semana" na
-- home da loja (só uma por vez — marcar uma nova desmarca a anterior).

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  name text not null,
  description text,
  instructions text,
  image_url text,
  ingredients jsonb not null default '[]'::jsonb,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

alter table recipes enable row level security;

drop policy if exists "dono gerencia receitas da propria loja" on recipes;
create policy "dono gerencia receitas da propria loja" on recipes for all
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

drop policy if exists "receita e publica" on recipes;
create policy "receita e publica" on recipes for select
  using (store_id in (select id from stores where active = true));
