-- Meu Mercado — v67.
-- Campanha no WhatsApp não registrava quem já tinha sido contatado — se o
-- dono rodasse a campanha de novo semana que vem (ou outra pessoa da
-- equipe rodasse), não tinha como saber quem já recebeu a mensagem, corria
-- risco de mandar em dobro pra uns e esquecer outros. campaign_contacts
-- guarda um registro por clique em "Enviar no WhatsApp".
create table if not exists public.campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  customer_id uuid references public.customers(id) on delete cascade not null,
  segment text not null,
  message text,
  contacted_at timestamptz not null default now()
);

create index if not exists idx_campaign_contacts_store on public.campaign_contacts(store_id);
create index if not exists idx_campaign_contacts_customer on public.campaign_contacts(customer_id);

alter table public.campaign_contacts enable row level security;

drop policy if exists "dono gerencia contatos de campanha da propria loja" on public.campaign_contacts;
create policy "dono gerencia contatos de campanha da propria loja" on public.campaign_contacts for all
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));
