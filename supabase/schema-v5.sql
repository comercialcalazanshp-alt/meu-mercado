-- Meu Mercado — v5.
-- Banners e ofertas agendadas: o dono sobe uma imagem (banner) com uma janela
-- de datas opcional (início/fim); a vitrine só mostra o que está dentro do
-- prazo e ativo. Sem prazo definido = fica no ar enquanto estiver ativo.

create table if not exists banners (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  title text not null,
  image_url text not null,
  link_url text,
  start_at timestamptz,
  end_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table banners enable row level security;

drop policy if exists "dono gerencia banners da propria loja" on banners;
create policy "dono gerencia banners da propria loja" on banners for all
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

-- Vitrine só enxerga banner ativo e dentro do prazo (janela aberta quando a
-- data correspondente é nula).
drop policy if exists "banner ativo e no prazo e publico" on banners;
create policy "banner ativo e no prazo e publico" on banners for select
  using (
    active = true
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at >= now())
  );
