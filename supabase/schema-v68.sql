-- Meu Mercado — v68.
-- O dono só podia apagar uma avaliação ruim, nunca responder — sem chance
-- de explicar o que aconteceu ou mostrar que resolveu o problema pro
-- cliente (e pra quem mais lê a avaliação). owner_reply é público, some
-- assim que o dono publica, igual resposta de loja no Google/Ifood.
alter table public.reviews add column if not exists owner_reply text;
alter table public.reviews add column if not exists owner_reply_at timestamptz;
alter table public.store_reviews add column if not exists owner_reply text;
alter table public.store_reviews add column if not exists owner_reply_at timestamptz;

drop policy if exists "dono responde avaliacoes de produto da propria loja" on public.reviews;
create policy "dono responde avaliacoes de produto da propria loja" on public.reviews for update
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

drop policy if exists "dono responde avaliacoes da loja" on public.store_reviews;
create policy "dono responde avaliacoes da loja" on public.store_reviews for update
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));
