-- Meu Mercado — v106.
-- Banner não tinha nenhuma métrica — kit e receita já mostram clique →
-- conversão, banner não tinha nada. Mesmo padrão de recipe_clicks
-- (schema-v69).
create table if not exists public.banner_clicks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  banner_id uuid references public.banners(id) on delete cascade not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_banner_clicks_banner on public.banner_clicks(banner_id);
create index if not exists idx_banner_clicks_store on public.banner_clicks(store_id);

alter table public.banner_clicks enable row level security;

drop policy if exists "qualquer um registra clique de banner" on public.banner_clicks;
create policy "qualquer um registra clique de banner" on public.banner_clicks for insert
  with check (
    exists (select 1 from public.banners b where b.id = banner_clicks.banner_id and b.store_id = banner_clicks.store_id)
  );

drop policy if exists "dono ve cliques de banner da propria loja" on public.banner_clicks;
create policy "dono ve cliques de banner da propria loja" on public.banner_clicks for select
  using (store_id in (select public.my_store_ids()));
