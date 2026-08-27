-- Meu Mercado — v120.
-- CORREÇÃO DE SEGURANÇA/DINHEIRO: customer_cancel_order (v108) só mudava
-- o status pra "cancelado" — não devolvia estoque, não desfazia cashback
-- usado nem o que tinha sido creditado (ganho + bônus de indicação), não
-- liberava de novo o uso do cupom. Um cliente podia comprar, ganhar
-- cashback, e cancelar na sequência — ficando com o cashback de um pedido
-- que nunca aconteceu, repetível à vontade. Também deixava o estoque real
-- desfasado do exibido pra sempre a cada cancelamento.
--
-- Backfill: antes da v118, TODO cashback (ganho + bônus) era creditado na
-- hora da compra, pra qualquer forma de pagamento — então é seguro (e
-- necessário) marcar cashback_credited_at = created_at em todo pedido já
-- existente que tinha cashback, senão a reversão abaixo não saberia que
-- esses pedidos antigos já creditaram de verdade.
update public.orders
  set cashback_credited_at = created_at
  where cashback_credited_at is null
    and (coalesce(cashback_earned, 0) > 0 or coalesce(referral_bonus_earned, 0) > 0);

create or replace function public.customer_cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order record;
  v_item jsonb;
  v_component jsonb;
  v_quantity int;
begin
  select id, status, store_id, items, coupon_code
    into v_order
    from public.orders where id = p_order_id;

  if v_order.id is null then
    raise exception 'Pedido não encontrado';
  end if;

  if v_order.status not in ('pendente', 'confirmado') then
    raise exception 'Esse pedido já está sendo preparado ou entregue — fale direto com a loja pra cancelar.';
  end if;

  update public.orders set status = 'cancelado', cancel_reason = 'Cancelado pelo cliente' where id = p_order_id;

  -- Devolve estoque de cada item (produto direto ou componente de kit).
  for v_item in select * from jsonb_array_elements(v_order.items)
  loop
    v_quantity := (v_item->>'quantity')::int;
    if v_item ? 'kit_id' then
      for v_component in
        select jsonb_build_object('product_id', product_id, 'quantity', quantity)
        from public.kit_items where kit_id = (v_item->>'kit_id')::uuid
      loop
        update public.products
          set stock = stock + (v_component->>'quantity')::int * v_quantity
          where id = (v_component->>'product_id')::uuid;
      end loop;
    elsif v_item ? 'product_id' then
      update public.products set stock = stock + v_quantity where id = (v_item->>'product_id')::uuid;
    end if;
  end loop;

  perform public.reverse_order_cashback(p_order_id);

  -- Libera de novo o uso do cupom — um pedido cancelado não deveria contar
  -- pro limite de uso nem pro "uso único por cliente".
  if v_order.coupon_code is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0)
      where store_id = v_order.store_id and upper(code) = upper(v_order.coupon_code);
  end if;
end;
$$;

grant execute on function public.customer_cancel_order(uuid) to anon, authenticated;
