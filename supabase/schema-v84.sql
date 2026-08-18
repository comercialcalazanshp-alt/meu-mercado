-- Meu Mercado — v84.
-- O Início do painel do Hub buscava pedidos só da própria loja da Hub
-- (store_id = hub). Isso fazia sentido antes, quando a Hub também vendia
-- direto — agora que os módulos operacionais saíram de lá pros afiliados,
-- a loja da Hub não gera mais pedido nenhum, e o Início ficaria sempre
-- mostrando zero mesmo com o marketplace inteiro vendendo normal.
-- get_hub_orders devolve os pedidos de TODAS as lojas do marketplace (a
-- própria Hub, se ainda vender algo, + cada afiliado ativo) — mesmo
-- formato de linha que a tela já usava, só trocando a fonte.
-- get_hub_visits_count soma as visitas no site do mesmo grupo de lojas.
-- security definer porque o RLS de orders/site_visits só deixa cada loja
-- ver os próprios dados — a Hub precisa enxergar o total do marketplace
-- sem violar o isolamento entre afiliados (não expõe nada além do que o
-- próprio afiliado já mostra pro cliente dele: pedido/visita, não senha
-- nem dado de outra tabela).

create or replace function public.get_hub_orders(
  p_hub_store_id uuid,
  p_since timestamptz
)
returns table (
  id uuid,
  total numeric,
  status text,
  created_at timestamptz,
  customer_phone text
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
  select o.id, o.total, o.status, o.created_at, o.customer_phone
  from public.orders o
  join hub_stores hs on hs.id = o.store_id
  where o.created_at >= p_since
  order by o.created_at asc;
$$;

grant execute on function public.get_hub_orders(uuid, timestamptz) to authenticated;

create or replace function public.get_hub_visits_count(
  p_hub_store_id uuid,
  p_since timestamptz
)
returns int
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
  select coalesce(sum(sv.page_views), 0)::int
  from public.site_visits sv
  join hub_stores hs on hs.id = sv.store_id
  where sv.first_seen_at >= p_since;
$$;

grant execute on function public.get_hub_visits_count(uuid, timestamptz) to authenticated;
