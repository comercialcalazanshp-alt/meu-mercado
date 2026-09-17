-- Limite de tentativa por IP nos endpoints públicos de pagamento (cartão e
-- Pix) — sem login, então a única trava até agora era por pedido, não por
-- quem está chamando. Ver src/lib/payment-rate-limit.ts.
create table if not exists public.payment_attempt_throttle (
  identifier text primary key,
  window_start timestamptz not null default now(),
  attempt_count int not null default 1
);

alter table public.payment_attempt_throttle enable row level security;
-- Sem policy pra anon/authenticated de propósito: só a chave de serviço
-- (usada nas rotas de pagamento) acessa essa tabela.
