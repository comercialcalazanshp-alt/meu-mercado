-- Pedidos: motivo de cancelamento + controle de reembolso pendente
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists refund_resolved boolean not null default false;
