-- Meu Mercado — v88.
-- Controle de moderação: o dono do Hub pediu poder bloquear o que um
-- afiliado publica (produto, banner) se não fizer sentido com a política
-- da plataforma — apesar do afiliado ter acesso total ao próprio painel,
-- o Hub precisa dessa trava de segurança. Hoje o Hub não tem NENHUMA
-- visibilidade sobre o que os afiliados publicam (RLS de products/banners
-- só deixa o próprio dono da loja ver/editar) — essas funções dão essa
-- visão e uma trava (desativar), sem dar ao Hub acesso total à loja do
-- afiliado (não edita nome/preço/foto, só ativa/desativa).

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
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select pr.id, pr.store_id, s.name, pr.name, pr.category, pr.price, pr.image_url, pr.active, pr.created_at
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
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.store_id, s.name, b.title, b.image_url, b.link_url, b.active, b.created_at
  from public.banners b
  join public.affiliate_partnerships ap on ap.module_store_id = b.store_id
  join public.stores s on s.id = b.store_id
  where ap.hub_store_id = p_hub_store_id and ap.active
    and p_hub_store_id in (select public.my_store_ids())
  order by b.created_at desc
  limit 300;
$$;

grant execute on function public.get_hub_moderation_banners(uuid) to authenticated;

-- Só liga/desliga (active) — nunca edita nome, preço, foto ou qualquer
-- outro dado da loja do afiliado. p_content_type restrito a um valor
-- conhecido de propósito (nunca monta SQL dinâmico com o texto que vem do
-- cliente).
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
    set active = p_active
    from public.affiliate_partnerships ap
    where ap.module_store_id = pr.store_id
      and ap.hub_store_id = p_hub_store_id
      and ap.active
      and pr.id = p_record_id;
  elsif p_content_type = 'banner' then
    update public.banners b
    set active = p_active
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
