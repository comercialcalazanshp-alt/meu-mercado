-- Meu Mercado — v109.
-- campaign_contacts (v67) registrava quem foi contatado, mas nada
-- cruzava isso com "voltou a comprar depois?" — o dono mandava mensagem
-- e nunca sabia se funcionou. Junta com orders (pedido do mesmo cliente
-- depois da data de contato) por segmento.
create or replace function public.campaign_report(p_store_id uuid)
returns table (
  segment text,
  contacted_count bigint,
  returned_count bigint,
  revenue_generated numeric
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  return query
  with contacts as (
    select cc.segment, cc.customer_id, min(cc.contacted_at) as first_contact
    from public.campaign_contacts cc
    where cc.store_id = p_store_id
    group by cc.segment, cc.customer_id
  ),
  returns as (
    select c.segment, c.customer_id,
      exists (
        select 1 from public.orders o
        where o.customer_id = c.customer_id and o.created_at > c.first_contact and o.status <> 'cancelado'
      ) as returned,
      coalesce((
        select sum(o.total) from public.orders o
        where o.customer_id = c.customer_id and o.created_at > c.first_contact and o.status <> 'cancelado'
      ), 0) as revenue
    from contacts c
  )
  select
    r.segment,
    count(*),
    count(*) filter (where r.returned),
    coalesce(sum(r.revenue), 0)
  from returns r
  group by r.segment;
end;
$$;

grant execute on function public.campaign_report(uuid) to authenticated;
