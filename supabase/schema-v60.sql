-- Meu Mercado — v60. Duas travas de integridade no módulo Caixa, achadas na
-- auditoria: nada impedia (a nível de banco) duas sessões de caixa abertas
-- ao mesmo tempo pra mesma loja (só a tela evitava, então dois
-- dispositivos/abas conseguiriam abrir caixa em paralelo), e um "reforço"
-- ou "sangria" com valor negativo ou zero só era barrado no front, nunca no
-- banco.

alter table public.cash_movements
  add constraint cash_movements_amount_positive check (amount > 0);

create unique index if not exists idx_cash_sessions_one_open_per_store
  on public.cash_sessions(store_id)
  where status = 'aberto';
