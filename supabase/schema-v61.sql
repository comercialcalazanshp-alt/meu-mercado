-- Meu Mercado — v61.
-- painel/pedidos "Editar itens" mudava orders.items/total mas nunca tocava
-- em products.stock — aumentar a quantidade de um item não descontava a
-- diferença, diminuir não devolvia. Com o tempo o estoque real desalinha
-- do que o sistema acha que tem.
--
-- adjust_order_items() devolve o estoque de TODOS os itens antigos do
-- pedido e desconta o estoque da lista nova inteira, tudo numa transação só
-- com trava de linha (mesma disciplina de checkout()/pdv_sale()) — o efeito
-- líquido é o delta certo, e uma tentativa de aumentar quantidade além do
-- estoque disponível é rejeitada em vez de deixar o estoque negativo.
create or replace function public.adjust_order_items(p_order_id uuid, p_items jsonb)
returns table (total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_old_items jsonb;
  v_delivery_fee numeric;
  v_discount_amount numeric;
  v_item jsonb;
  v_component jsonb;
  v_qty numeric;
  v_product record;
  v_new_total numeric := 0;
begin
  select store_id, items, delivery_fee, discount_amount
    into v_store_id, v_old_items, v_delivery_fee, v_discount_amount
    from public.orders where id = p_order_id
    for update;

  if not found then
    raise exception 'Pedido não encontrado';
  end if;

  if v_store_id not in (select public.my_store_ids()) then
    raise exception 'Não autorizado';
  end if;

  -- devolve o estoque de tudo que estava no pedido antes da edição
  for v_item in select * from jsonb_array_elements(v_old_items)
  loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    if v_item ? 'product_id' then
      update public.products set stock = stock + v_qty where id = (v_item->>'product_id')::uuid;
    elsif v_item ? 'kit_id' then
      for v_component in
        select jsonb_build_object('product_id', product_id, 'quantity', quantity)
        from public.kit_items where kit_id = (v_item->>'kit_id')::uuid
      loop
        update public.products set stock = stock + (v_component->>'quantity')::numeric * v_qty
          where id = (v_component->>'product_id')::uuid;
      end loop;
    end if;
  end loop;

  -- desconta o estoque da lista nova, travando cada produto envolvido e
  -- rejeitando se não tiver o suficiente (em vez de deixar negativo)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    if v_qty <= 0 then
      continue;
    end if;

    if v_item ? 'product_id' then
      select id, name, stock into v_product from public.products
        where id = (v_item->>'product_id')::uuid for update;
      if not found or v_product.stock < v_qty then
        raise exception 'Estoque insuficiente para "%"', coalesce(v_product.name, 'produto removido');
      end if;
      update public.products set stock = stock - v_qty where id = v_product.id;
      v_new_total := v_new_total + v_qty * coalesce((v_item->>'price')::numeric, 0);
    elsif v_item ? 'kit_id' then
      for v_component in
        select jsonb_build_object('product_id', product_id, 'quantity', quantity)
        from public.kit_items where kit_id = (v_item->>'kit_id')::uuid
      loop
        select id, name, stock into v_product from public.products
          where id = (v_component->>'product_id')::uuid for update;
        if not found or v_product.stock < (v_component->>'quantity')::numeric * v_qty then
          raise exception 'Estoque insuficiente pro componente "%" do kit', coalesce(v_product.name, 'produto removido');
        end if;
        update public.products set stock = stock - (v_component->>'quantity')::numeric * v_qty
          where id = v_product.id;
      end loop;
      v_new_total := v_new_total + v_qty * coalesce((v_item->>'price')::numeric, 0);
    else
      -- item sem product_id/kit_id (linha antiga digitada a mão) — soma no
      -- total normalmente, só não mexe em estoque, igual já era antes.
      v_new_total := v_new_total + v_qty * coalesce((v_item->>'price')::numeric, 0);
    end if;
  end loop;

  v_new_total := v_new_total + coalesce(v_delivery_fee, 0) - coalesce(v_discount_amount, 0);

  update public.orders set items = p_items, total = v_new_total where id = p_order_id;

  return query select v_new_total;
end;
$$;
