-- Meu Mercado — v81.
-- Reformulação visual da vitrine do hub: a nova Home (neutra, "plataforma",
-- não "site do Comercial Calazans") precisa de um jeito de buscar/mostrar
-- produtos de TODAS as lojas do hub (a própria + afiliados ativos) numa
-- tela só — hoje só existe get_hub_modules() (lista de lojas), nada que
-- traga produtos cruzando lojas. Mesma família de função (só leitura,
-- security definer, não toca em orders/checkout/dinheiro).

create or replace function public.get_hub_offers(
  p_hub_store_id uuid,
  p_search text default null,
  p_only_offers boolean default false,
  p_limit int default 20
)
returns table (
  product_id uuid,
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
    and (p_search is null or trim(p_search) = '' or pr.name ilike '%' || trim(p_search) || '%')
    and (not p_only_offers or (pr.on_offer and pr.offer_price is not null and (pr.offer_ends_at is null or pr.offer_ends_at > now())))
  order by (pr.on_offer and pr.offer_price is not null) desc, pr.created_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_hub_offers(uuid, text, boolean, int) to anon, authenticated;
