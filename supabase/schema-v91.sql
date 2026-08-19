-- Meu Mercado — v91.
-- Convite direto de afiliado: hoje, pra virar afiliado, a pessoa precisa
-- se cadastrar sozinha em /cadastro (criando a própria loja do zero) e só
-- depois o Hub procura pelo nome/slug e liga. Isso trava crescimento —
-- fica invertido (o afiliado tem que adivinhar que precisa se cadastrar
-- antes). Esse fluxo novo espelha o que já existe pro entregador: o Hub
-- preenche os termos da parceria ANTES, manda um link por WhatsApp, a
-- pessoa clica, cria a própria conta (e-mail/senha de verdade, porque é
-- dono de loja, não entregador) e já entra ligada — tudo num passo.
--
-- stores.owner_id é "not null" (schema-v1), então não dá pra pré-criar a
-- loja como se faz com store_members do entregador (que é só e-mail,
-- sem FK) — por isso os termos ficam guardados aqui até serem aceitos,
-- e só na aceitação (via API com service role) é que loja + conta +
-- parceria são criadas juntas.
create table if not exists public.affiliate_invites (
  id uuid primary key default gen_random_uuid(),
  hub_store_id uuid references public.stores(id) on delete cascade not null,
  category text not null,
  suggested_store_name text not null,
  owner_name text not null,
  tax_id text not null,
  address text not null,
  whatsapp text not null,
  commission_percent numeric not null default 0 check (commission_percent >= 0 and commission_percent <= 100),
  payout_method text not null default 'manual' check (payout_method in ('manual', 'split_automatico')),
  payout_speed text check (payout_speed is null or payout_speed in ('48h', '72h', 'semanal')),
  plan_type text not null default 'padrao' check (plan_type in ('padrao', 'personalizado')),
  billing_cycle text not null default 'mensal' check (billing_cycle in ('mensal', 'trimestral', 'semestral', 'anual')),
  subscription_price numeric,
  status text not null default 'pendente' check (status in ('pendente', 'aceito', 'cancelado')),
  partnership_id uuid references public.affiliate_partnerships(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists idx_affiliate_invites_hub on public.affiliate_invites (hub_store_id, created_at);

alter table public.affiliate_invites enable row level security;

-- Só o dono do hub gerencia — a leitura pra tela pública de aceite
-- (/afiliado/aceitar/[id]) passa inteira por service role no servidor,
-- igual já acontece com /entregador/aceitar, então não precisa de policy
-- de leitura anônima aqui (menos superfície exposta).
drop policy if exists "dono gerencia convites do proprio hub" on public.affiliate_invites;
create policy "dono gerencia convites do proprio hub" on public.affiliate_invites for all
  using (hub_store_id in (select public.my_store_ids()))
  with check (hub_store_id in (select public.my_store_ids()));
