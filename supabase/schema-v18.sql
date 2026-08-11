-- Meu Mercado — v18.
-- Níveis de fidelidade (Bronze/Prata/Ouro): opcional, igual ao cashback —
-- loja com os dois limites zerados continua sem nenhum nível, nada muda.
-- Quando configurado, todo cliente vira Bronze por padrão e sobe de nível
-- conforme o total gasto na loja (soma dos pedidos não cancelados).

alter table stores add column if not exists loyalty_silver_threshold numeric not null default 0;
alter table stores add column if not exists loyalty_gold_threshold numeric not null default 0;
