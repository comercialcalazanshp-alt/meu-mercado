-- Meu Mercado — v110.
-- Cliente só tinha 1 endereço salvo (default_address em customer_profiles),
-- sobrescrito sem avisar a cada pedido novo — quem entrega em casa e no
-- trabalho não conseguia guardar os dois. Agora vários endereços
-- nomeados, o cliente escolhe qual usar (ou digita um novo, sem salvar).
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.customer_profiles(id) on delete cascade not null,
  label text not null,
  address text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_addresses_profile on public.customer_addresses(profile_id);

alter table public.customer_addresses enable row level security;

drop policy if exists "cliente gerencia os proprios enderecos" on public.customer_addresses;
create policy "cliente gerencia os proprios enderecos" on public.customer_addresses for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
