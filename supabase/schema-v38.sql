-- Painel de Pedidos: nota interna + marcação de "visto"
alter table public.orders add column if not exists seen_at timestamptz;
alter table public.orders add column if not exists internal_note text;
