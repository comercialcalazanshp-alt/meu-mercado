-- Meu Mercado — v87.
-- Cobrança de mensalidade do afiliado, via Pix, mesma integração PagBank já
-- usada no checkout de cliente (create-pix/webhook). affiliate_ai_purchases
-- já existia (v73) mas nunca tinha rota que gerasse o Pix de verdade — só
-- essa tabela nova (pra mensalidade) precisa ser criada.
create table if not exists public.affiliate_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid references public.affiliate_partnerships(id) on delete cascade not null,
  amount numeric not null check (amount > 0),
  billing_cycle text not null,
  pagbank_order_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_affiliate_subscription_payments_partnership
  on public.affiliate_subscription_payments (partnership_id, created_at);

alter table public.affiliate_subscription_payments enable row level security;

-- Só leitura por app — toda escrita (criar cobrança, marcar pago) passa
-- pela API com service role (mesmo padrão de orders/hub_orders), porque o
-- valor cobrado tem que vir do subscription_price gravado no servidor, não
-- de algo que o navegador poderia forjar.
drop policy if exists "dono ve cobrancas do proprio hub" on public.affiliate_subscription_payments;
create policy "dono ve cobrancas do proprio hub" on public.affiliate_subscription_payments for select
  using (partnership_id in (
    select id from public.affiliate_partnerships where hub_store_id in (select public.my_store_ids())
  ));

drop policy if exists "afiliado ve as proprias cobrancas" on public.affiliate_subscription_payments;
create policy "afiliado ve as proprias cobrancas" on public.affiliate_subscription_payments for select
  using (partnership_id in (
    select id from public.affiliate_partnerships where module_store_id in (select public.my_store_ids())
  ));
