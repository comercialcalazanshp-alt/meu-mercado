-- Meu Mercado — v93.
-- Achado sério na revisão de entregador: um pedido de Hub (carrinho com
-- produto de várias lojas) cria uma linha em "orders" POR LOJA — o
-- entregador via cada perna solta, sem saber que são a MESMA entrega pra
-- 1 cliente só, precisando passar em N lojas antes de sair. A tabela
-- affiliate_order_stops (v73) já guarda o ponto de retirada de cada perna,
-- mas nunca tinha sido lida em lugar nenhum do app.
--
-- get_hub_delivery_orders: devolve cada perna de cada hub_order pendente,
-- já com o ponto de retirada — o cliente (React) agrupa por hub_order_id
-- pra virar "1 entrega, N paradas". security definer porque a RLS de
-- orders/affiliate_order_stops só libera pra quem é da MESMA loja de cada
-- perna (my_pdv_store_ids()) — um entregador do Hub precisa ver a perna
-- de TODAS as lojas afiliadas envolvidas, não só da própria.
--
-- update_hub_delivery_status: atualiza o status de TODAS as pernas de um
-- hub_order de uma vez (sem isso, teria que atualizar pedido por pedido,
-- e a policy de update também não libera loja alheia).
create or replace function public.get_hub_delivery_orders(p_store_id uuid)
returns table (
  hub_order_id uuid,
  hub_customer_name text,
  hub_customer_phone text,
  hub_order_created_at timestamptz,
  order_id uuid,
  order_store_id uuid,
  order_store_name text,
  order_status text,
  order_total numeric,
  order_payment_method text,
  order_pix_paid_at timestamptz,
  order_card_paid_at timestamptz,
  order_delivery_address text,
  stop_address text,
  stop_lat numeric,
  stop_lng numeric,
  stop_picked_up_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with relevant_hub_orders as (
    select ho.id, ho.customer_name, ho.customer_phone, ho.created_at
    from public.hub_orders ho
    where ho.hub_store_id = p_store_id
      and p_store_id in (select public.my_pdv_store_ids())
      and exists (
        select 1 from public.orders o
        where o.hub_order_id = ho.id and o.status in ('confirmado', 'entregando')
      )
  )
  select
    rho.id, rho.customer_name, rho.customer_phone, rho.created_at,
    o.id, o.store_id, s.name, o.status, o.total, o.payment_method, o.pix_paid_at, o.card_paid_at, o.delivery_address,
    aos.address, aos.lat, aos.lng, aos.picked_up_at
  from relevant_hub_orders rho
  join public.orders o on o.hub_order_id = rho.id
  join public.stores s on s.id = o.store_id
  left join public.affiliate_order_stops aos on aos.order_id = o.id
  order by rho.created_at asc;
$$;

grant execute on function public.get_hub_delivery_orders(uuid) to authenticated;

create or replace function public.update_hub_delivery_status(p_hub_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hub_store_id uuid;
begin
  if p_status not in ('entregando', 'entregue') then
    raise exception 'Status inválido';
  end if;

  select hub_store_id into v_hub_store_id from public.hub_orders where id = p_hub_order_id;
  if v_hub_store_id is null or v_hub_store_id not in (select public.my_pdv_store_ids()) then
    raise exception 'Não autorizado';
  end if;

  if p_status = 'entregando' then
    update public.orders set status = 'entregando', out_for_delivery_at = now()
    where hub_order_id = p_hub_order_id and status = 'confirmado';
  else
    update public.orders set status = 'entregue', delivered_at = now()
    where hub_order_id = p_hub_order_id and status in ('confirmado', 'entregando');
  end if;
end;
$$;

grant execute on function public.update_hub_delivery_status(uuid, text) to authenticated;
