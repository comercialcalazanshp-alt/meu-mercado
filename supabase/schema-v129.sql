-- Meu Mercado — v129.
-- Estorno de venda do PDV: não existia nenhum jeito de desfazer uma venda de
-- balcão já finalizada (só dava pra limpar o carrinho ANTES de finalizar).
-- Erro de item, de quantidade, ou cliente devolvendo algo depois de pago
-- ficavam sem solução dentro do sistema. pdv_void_sale devolve o estoque de
-- cada item (produto ou componente de kit, mesma lógica de
-- customer_cancel_order em schema-v120), reverte o valor fiado se a venda
-- (ou parte dela, no pagamento dividido) tiver sido no crediário, e marca a
-- venda como cancelada. Só o dono (papel "completo") pode estornar — não é
-- ação que um caixa deveria poder fazer sozinho, é dinheiro de verdade.
create or replace function public.pdv_void_sale(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order record;
  v_item jsonb;
  v_component record;
  v_split jsonb;
  v_quantity numeric;
  v_fiado_amount numeric := 0;
  v_customer_id uuid;
begin
  select id, store_id, status, channel, items, total, payment_method, payment_split, customer_phone
    into v_order
    from public.orders
    where id = p_order_id;

  if v_order.id is null then
    raise exception 'Venda não encontrada';
  end if;

  if v_order.store_id not in (select public.my_pdv_store_ids()) then
    raise exception 'Sem permissão pra essa loja';
  end if;

  if public.get_my_role(v_order.store_id) <> 'completo' then
    raise exception 'Só o dono da loja pode estornar uma venda';
  end if;

  if v_order.channel <> 'balcao' then
    raise exception 'Só dá pra estornar vendas feitas no balcão (PDV)';
  end if;

  if v_order.status = 'cancelado' then
    raise exception 'Essa venda já foi estornada';
  end if;

  -- Devolve estoque de cada item (produto direto ou componente de kit) —
  -- mesma lógica de customer_cancel_order (schema-v120).
  for v_item in select * from jsonb_array_elements(v_order.items)
  loop
    v_quantity := (v_item->>'quantity')::numeric;
    if v_item ? 'kit_id' then
      for v_component in
        select product_id, quantity from public.kit_items where kit_id = (v_item->>'kit_id')::uuid
      loop
        update public.products
          set stock = stock + v_component.quantity * v_quantity
          where id = v_component.product_id;
      end loop;
    elsif v_item ? 'product_id' then
      update public.products set stock = stock + v_quantity where id = (v_item->>'product_id')::uuid;
    end if;
  end loop;

  -- Descobre quanto dessa venda foi fiado (tudo, se payment_method='fiado';
  -- só a parte fiado, se foi pagamento dividido) pra reverter a dívida.
  if v_order.payment_method = 'fiado' then
    v_fiado_amount := v_order.total;
  elsif v_order.payment_method = 'dividido' and v_order.payment_split is not null then
    for v_split in select * from jsonb_array_elements(v_order.payment_split)
    loop
      if v_split->>'method' = 'fiado' then
        v_fiado_amount := v_fiado_amount + (v_split->>'amount')::numeric;
      end if;
    end loop;
  end if;

  if v_fiado_amount > 0 and v_order.customer_phone is not null then
    select id into v_customer_id
      from public.credit_customers
      where store_id = v_order.store_id and phone = v_order.customer_phone;

    if v_customer_id is not null then
      insert into public.credit_transactions (customer_id, type, amount, note)
      values (v_customer_id, 'baixa', v_fiado_amount, 'Estorno de venda cancelada no PDV');
    end if;
  end if;

  update public.orders
    set status = 'cancelado', cancel_reason = 'Estornada pelo dono no PDV'
    where id = p_order_id;
end;
$$;

grant execute on function public.pdv_void_sale(uuid) to authenticated;
