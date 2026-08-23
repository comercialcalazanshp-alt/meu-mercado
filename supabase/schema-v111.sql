-- Meu Mercado — v111.
-- Cliente não tinha como marcar produto favorito pra achar rápido depois
-- (só busca por nome e carrinho existiam).
create table if not exists public.customer_favorites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.customer_profiles(id) on delete cascade not null,
  store_id uuid references public.stores(id) on delete cascade not null,
  product_id uuid references public.products(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (profile_id, product_id)
);

create index if not exists idx_customer_favorites_profile_store on public.customer_favorites(profile_id, store_id);

alter table public.customer_favorites enable row level security;

drop policy if exists "cliente gerencia os proprios favoritos" on public.customer_favorites;
create policy "cliente gerencia os proprios favoritos" on public.customer_favorites for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
