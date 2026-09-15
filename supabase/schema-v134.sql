-- Prazo combinado do crediário (em dias) — usado pra: (1) preencher sozinho
-- o vencimento de uma venda fiado nova, e (2) ser a base da reserva de
-- capital de giro recomendada até existir dado real suficiente (pagamentos
-- registrados) pra medir o prazo de verdade.
alter table public.stores add column if not exists credit_term_days integer not null default 30;
