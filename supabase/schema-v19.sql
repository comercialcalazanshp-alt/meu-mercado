-- Meu Mercado — v19.
-- Avaliação da loja inteira: diferente da avaliação por produto (tabela
-- reviews), essa é sobre a experiência geral com a loja — atendimento,
-- entrega, etc. Mesmo espírito: qualquer cliente avalia sem login, dono
-- modera o que for inadequado.

create table if not exists store_reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  customer_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table store_reviews enable row level security;

drop policy if exists "avaliacoes da loja sao publicas" on store_reviews;
create policy "avaliacoes da loja sao publicas" on store_reviews for select
  using (true);

drop policy if exists "qualquer um avalia loja ativa" on store_reviews;
create policy "qualquer um avalia loja ativa" on store_reviews for insert
  with check (
    exists (select 1 from stores s where s.id = store_reviews.store_id and s.active = true)
  );

drop policy if exists "dono modera avaliacoes da propria loja" on store_reviews;
create policy "dono modera avaliacoes da propria loja" on store_reviews for delete
  using (store_id in (select id from stores where owner_id = auth.uid()));
