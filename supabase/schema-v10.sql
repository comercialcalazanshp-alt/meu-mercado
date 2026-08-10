-- Meu Mercado — v10.
-- Analytics de tráfego: cada visita anônima na vitrine gera uma "sessão"
-- (id aleatório guardado no sessionStorage do navegador — dura enquanto a
-- aba fica aberta). A gente registra quantas telas ela viu, quanto tempo
-- ficou e se terminou comprando, pro dono ver no painel.

create table if not exists site_visits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  session_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  page_views integer not null default 1,
  converted boolean not null default false,
  unique (store_id, session_id)
);

alter table site_visits enable row level security;

drop policy if exists "qualquer um registra visita" on site_visits;
create policy "qualquer um registra visita" on site_visits for insert
  with check (true);

drop policy if exists "qualquer um atualiza a propria sessao" on site_visits;
create policy "qualquer um atualiza a propria sessao" on site_visits for update
  using (true)
  with check (true);

drop policy if exists "dono ve trafego da propria loja" on site_visits;
create policy "dono ve trafego da propria loja" on site_visits for select
  using (store_id in (select id from stores where owner_id = auth.uid()));
