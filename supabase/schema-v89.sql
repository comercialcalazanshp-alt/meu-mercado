-- Meu Mercado — v89.
-- Achado sério na moderação (v88): ela mexia na MESMA coluna "active" que
-- o afiliado já controla livremente no próprio painel — ou seja, o
-- afiliado podia desfazer o bloqueio do Hub com um clique na tela dele
-- (ou até sem querer, só reativando o produto). blocked_by_hub é uma trava
-- SEPARADA, que só o Hub controla — visibilidade pública passa a exigir
-- active = true E blocked_by_hub = false, então nenhum dos dois lados
-- consegue derrubar a decisão do outro sozinho.
alter table public.products add column if not exists blocked_by_hub boolean not null default false;
alter table public.banners add column if not exists blocked_by_hub boolean not null default false;

drop policy if exists "produto ativo e publico" on public.products;
create policy "produto ativo e publico" on public.products for select
  using (active = true and not blocked_by_hub);

drop policy if exists "banner ativo e no prazo e publico" on public.banners;
create policy "banner ativo e no prazo e publico" on public.banners for select
  using (
    active = true
    and not blocked_by_hub
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at >= now())
  );

-- get_hub_offers (v81/v82) é security definer — ignora RLS por completo,
-- então a política acima sozinha não bastava pra ela: precisa do mesmo
-- filtro explícito, senão a busca/ofertas da Home continuariam mostrando
-- produto bloqueado.
drop function if exists public.get_hub_offers(uuid, text, boolean, int);

create function public.get_hub_offers(
  p_hub_store_id uuid,
  p_search text default null,
  p_only_offers boolean default false,
  p_limit int default 20
)
returns table (
  id uuid,
  name text,
  category text,
  price numeric,
  image_url text,
  stock int,
  on_offer boolean,
  offer_price numeric,
  offer_ends_at timestamptz,
  created_at timestamptz,
  promo_buy_qty int,
  promo_pay_qty int,
  price_wholesale numeric,
  wholesale_min_qty int,
  barcode text,
  store_id uuid,
  store_name text,
  store_slug text,
  brand_color text,
  accent_color text
)
language sql
security definer
set search_path = public
stable
as $$
  with hub_stores as (
    select p_hub_store_id as id
    union
    select ap.module_store_id from public.affiliate_partnerships ap
    where ap.hub_store_id = p_hub_store_id and ap.active
  )
  select
    pr.id, pr.name, pr.category, pr.price, pr.image_url, pr.stock,
    pr.on_offer, pr.offer_price, pr.offer_ends_at, pr.created_at,
    pr.promo_buy_qty, pr.promo_pay_qty, pr.price_wholesale, pr.wholesale_min_qty, pr.barcode,
    s.id, s.name, s.slug, s.brand_color, s.accent_color
  from public.products pr
  join hub_stores hs on hs.id = pr.store_id
  join public.stores s on s.id = pr.store_id and s.active
  where pr.active
    and not pr.blocked_by_hub
    and (p_search is null or trim(p_search) = '' or pr.name ilike '%' || trim(p_search) || '%')
    and (not p_only_offers or (pr.on_offer and pr.offer_price is not null and (pr.offer_ends_at is null or pr.offer_ends_at > now())))
  order by (pr.on_offer and pr.offer_price is not null) desc, pr.created_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_hub_offers(uuid, text, boolean, int) to anon, authenticated;

-- Passa a existir também nas duas funções de leitura da moderação, pra
-- tela distinguir "o afiliado desligou" de "o Hub bloqueou".
create or replace function public.get_hub_moderation_products(p_hub_store_id uuid)
returns table (
  id uuid,
  store_id uuid,
  store_name text,
  name text,
  category text,
  price numeric,
  image_url text,
  active boolean,
  blocked_by_hub boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select pr.id, pr.store_id, s.name, pr.name, pr.category, pr.price, pr.image_url, pr.active, pr.blocked_by_hub, pr.created_at
  from public.products pr
  join public.affiliate_partnerships ap on ap.module_store_id = pr.store_id
  join public.stores s on s.id = pr.store_id
  where ap.hub_store_id = p_hub_store_id and ap.active
    and p_hub_store_id in (select public.my_store_ids())
  order by pr.created_at desc
  limit 300;
$$;

grant execute on function public.get_hub_moderation_products(uuid) to authenticated;

create or replace function public.get_hub_moderation_banners(p_hub_store_id uuid)
returns table (
  id uuid,
  store_id uuid,
  store_name text,
  title text,
  image_url text,
  link_url text,
  active boolean,
  blocked_by_hub boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.store_id, s.name, b.title, b.image_url, b.link_url, b.active, b.blocked_by_hub, b.created_at
  from public.banners b
  join public.affiliate_partnerships ap on ap.module_store_id = b.store_id
  join public.stores s on s.id = b.store_id
  where ap.hub_store_id = p_hub_store_id and ap.active
    and p_hub_store_id in (select public.my_store_ids())
  order by b.created_at desc
  limit 300;
$$;

grant execute on function public.get_hub_moderation_banners(uuid) to authenticated;

-- Agora trava blocked_by_hub, não active — o afiliado continua dono total
-- do próprio "active" (usa isso pra pausar produto sem fim de estoque
-- etc.), e o Hub controla só a trava dele, independente.
create or replace function public.hub_moderate_set_active(
  p_hub_store_id uuid,
  p_content_type text,
  p_record_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_hub_store_id not in (select public.my_store_ids()) then
    raise exception 'Não autorizado';
  end if;

  if p_content_type = 'produto' then
    update public.products pr
    set blocked_by_hub = not p_active
    from public.affiliate_partnerships ap
    where ap.module_store_id = pr.store_id
      and ap.hub_store_id = p_hub_store_id
      and ap.active
      and pr.id = p_record_id;
  elsif p_content_type = 'banner' then
    update public.banners b
    set blocked_by_hub = not p_active
    from public.affiliate_partnerships ap
    where ap.module_store_id = b.store_id
      and ap.hub_store_id = p_hub_store_id
      and ap.active
      and b.id = p_record_id;
  else
    raise exception 'Tipo de conteúdo inválido';
  end if;
end;
$$;

grant execute on function public.hub_moderate_set_active(uuid, text, uuid, boolean) to authenticated;
