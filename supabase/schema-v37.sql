-- Pagamento com cartão via PagBank no checkout do site.
alter table public.orders add column if not exists card_paid_at timestamptz;
alter table public.orders add column if not exists card_last_digits text;
alter table public.orders add column if not exists card_brand text;
