-- Meu Mercado — v101.
-- Dois pedidos do dono: (1) poder ligar juros no parcelamento do cartão
-- (hoje é sempre sem juros — v100 adicionou o parcelamento em si) e (2)
-- um lugar pra guardar as taxas que a PagBank/Efí cobram por transação,
-- só pra acompanhar o custo (não é usado em cálculo automático ainda,
-- é preenchido manualmente com o que consta no contrato/extrato).
alter table public.stores add column if not exists card_installment_interest_enabled boolean not null default false;
alter table public.stores add column if not exists card_installment_interest_percent numeric not null default 0;
alter table public.stores add column if not exists fee_pix_percent numeric not null default 0;
alter table public.stores add column if not exists fee_card_percent numeric not null default 0;
alter table public.stores add column if not exists fee_boleto_fixed numeric not null default 0;
