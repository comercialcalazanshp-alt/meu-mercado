-- Meu Mercado — v90.
-- Reputação: Moderação (v88/v89) cobre CONTEÚDO publicado — isso aqui
-- cobre QUALIDADE DE SERVIÇO (nota do produto, reclamação de cliente),
-- que hoje só existe isolado no painel de cada afiliado. O Hub precisa
-- enxergar isso agregado pra decidir sobre uma parceria antes que vire
-- prejuízo pra marca inteira (não é a mesma coisa que moderar produto —
-- é acompanhar como o afiliado está atendendo).
--
-- reviews já é pública (schema-v9, "avaliacoes sao publicas" using true),
-- então não precisava de função pra isso — mas complaints é privada
-- ("dono gerencia reclamacoes da propria loja", my_store_ids()), por
-- isso security definer aqui. Detalhe da reclamação devolve categoria e
-- descrição, mas NUNCA nome/telefone do cliente — o Hub precisa saber que
-- tem problema, não precisa dos dados do cliente de outra loja.

create or replace function public.get_hub_reputation(p_hub_store_id uuid)
returns table (
  store_id uuid,
  store_name text,
  avg_rating numeric,
  review_count bigint,
  complaint_count bigint,
  complaint_open_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with hub_affiliates as (
    select ap.module_store_id as store_id
    from public.affiliate_partnerships ap
    where ap.hub_store_id = p_hub_store_id and ap.active
      and p_hub_store_id in (select public.my_store_ids())
  )
  select
    s.id,
    s.name,
    (select round(avg(r.rating), 2) from public.reviews r where r.store_id = s.id),
    (select count(*) from public.reviews r where r.store_id = s.id),
    (select count(*) from public.complaints c where c.store_id = s.id),
    (select count(*) from public.complaints c where c.store_id = s.id and c.status <> 'resolvida')
  from hub_affiliates ha
  join public.stores s on s.id = ha.store_id;
$$;

grant execute on function public.get_hub_reputation(uuid) to authenticated;

create or replace function public.get_hub_complaints_detail(p_hub_store_id uuid)
returns table (
  id uuid,
  store_id uuid,
  store_name text,
  category text,
  description text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.store_id, s.name, c.category, c.description, c.status, c.created_at
  from public.complaints c
  join public.affiliate_partnerships ap on ap.module_store_id = c.store_id
  join public.stores s on s.id = c.store_id
  where ap.hub_store_id = p_hub_store_id and ap.active
    and p_hub_store_id in (select public.my_store_ids())
  order by c.created_at desc
  limit 200;
$$;

grant execute on function public.get_hub_complaints_detail(uuid) to authenticated;
