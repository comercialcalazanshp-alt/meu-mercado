-- Meu Mercado — v58. Auditoria de segurança e performance (2026-08-14).
-- Achados nesta auditoria, todos corrigidos aqui:
--
-- 1) Índices ausentes nas colunas de filtro mais usadas (store_id, customer_id,
--    product_id) em quase toda tabela — hoje o volume de dados é pequeno e não
--    dá pra notar, mas toda política de RLS filtra por essas colunas, e sem
--    índice isso vira scan de tabela inteira conforme o número de pedidos/
--    produtos/clientes cresce. É exatamente o tipo de coisa que faz o site
--    ficar lento "do nada" quando começa a ter movimento de verdade.
--
-- 2) get_or_create_scratch_card(uuid, text) — a versão antiga por telefone,
--    de antes da raspadinha virar vinculada à conta do cliente (v55), nunca
--    foi removida. O front não chama mais ela, mas continuava executável por
--    qualquer cliente logado, aceitando um telefone arbitrário digitado na
--    hora — dado órfão (sem profile_id) que não afeta o desconto de ninguém,
--    mas é superfície de ataque morta que não precisa continuar exposta.
--
-- 3) "qualquer um cria lista compartilhada" (shared_lists) aceitava qualquer
--    payload, de qualquer loja (existente ou não), sem limite de tamanho —
--    dava pra qualquer um (sem estar logado) inserir dado arbitrário em
--    volume ilimitado nessa tabela. Agora exige loja ativa de verdade e um
--    carrinho de tamanho razoável.

-- --- 1) Índices ---
create index if not exists idx_products_store_id on public.products(store_id);
create index if not exists idx_orders_store_id on public.orders(store_id);
create index if not exists idx_orders_customer_id on public.orders(customer_id);
create index if not exists idx_orders_created_at on public.orders(created_at);
create index if not exists idx_banners_store_id on public.banners(store_id);
create index if not exists idx_kits_store_id on public.kits(store_id);
create index if not exists idx_reviews_product_id on public.reviews(product_id);
create index if not exists idx_reviews_store_id on public.reviews(store_id);
create index if not exists idx_store_reviews_store_id on public.store_reviews(store_id);
create index if not exists idx_cash_sessions_store_id on public.cash_sessions(store_id);
create index if not exists idx_cash_movements_session_id on public.cash_movements(session_id);
create index if not exists idx_stock_movements_store_id on public.stock_movements(store_id);
create index if not exists idx_stock_movements_product_id on public.stock_movements(product_id);
create index if not exists idx_expenses_store_id on public.expenses(store_id);
create index if not exists idx_neighborhoods_store_id on public.neighborhoods(store_id);
create index if not exists idx_push_subscriptions_store_id on public.push_subscriptions(store_id);
create index if not exists idx_recipes_store_id on public.recipes(store_id);
create index if not exists idx_subscriptions_store_id on public.subscriptions(store_id);
create index if not exists idx_influencers_store_id on public.influencers(store_id);
create index if not exists idx_commission_payments_store_id on public.commission_payments(store_id);
create index if not exists idx_product_price_history_store_id on public.product_price_history(store_id);
create index if not exists idx_kit_price_history_store_id on public.kit_price_history(store_id);
create index if not exists idx_credit_transactions_customer_id on public.credit_transactions(customer_id);
create index if not exists idx_scratch_cards_store_id on public.scratch_cards(store_id);
create index if not exists idx_shared_lists_store_id on public.shared_lists(store_id);

-- --- 2) Remove a versão antiga (por telefone) da raspadinha ---
drop function if exists public.get_or_create_scratch_card(uuid, text);

-- --- 3) Trava o que pode ser inserido em shared_lists sem login ---
drop policy if exists "qualquer um cria lista compartilhada" on public.shared_lists;
create policy "qualquer um cria lista compartilhada" on public.shared_lists for insert
  with check (
    exists (select 1 from public.stores s where s.id = shared_lists.store_id and s.active = true)
    and jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 50
  );
