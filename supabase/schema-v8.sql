-- Meu Mercado — v8.
-- Relatórios: meta de vendas mensal (guardada na própria loja) e produtos
-- parados (precisa saber qual produto está por trás de cada item do pedido,
-- por isso o checkout passa a gravar product_id/kit_id dentro de cada item —
-- até aqui só gravava nome/preço/quantidade, suficiente pro pedido mas não
-- pra relatório).

alter table stores add column if not exists sales_goal numeric not null default 0;

create or replace function public.checkout(
  p_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_coupon_code text default null
)
returns table (order_id uuid, total numeric, discount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_component jsonb;
  v_product record;
  v_kit record;
  v_quantity int;
  v_needed int;
  v_subtotal numeric := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_coupon record;
  v_discount numeric := 0;
  v_total numeric;
begin
  if p_customer_name is null or trim(p_customer_name) = '' then
    raise exception 'Nome do cliente é obrigatório';
  end if;
  if p_customer_phone is null or trim(p_customer_phone) = '' then
    raise exception 'WhatsApp do cliente é obrigatório';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Carrinho vazio';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::int;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida';
    end if;

    if v_item ? 'kit_id' then
      select id, name, price into v_kit
      from public.kits
      where id = (v_item->>'kit_id')::uuid
        and store_id = p_store_id
        and active = true;

      if not found then
        raise exception 'Um dos kits não está mais disponível';
      end if;

      for v_component in
        select jsonb_build_object('product_id', product_id, 'quantity', quantity)
        from public.kit_items where kit_id = v_kit.id
      loop
        select id, name, stock into v_product
        from public.products
        where id = (v_component->>'product_id')::uuid
          and store_id = p_store_id
          and active = true
        for update;

        if not found then
          raise exception 'Um produto do kit "%" não está mais disponível', v_kit.name;
        end if;

        v_needed := (v_component->>'quantity')::int * v_quantity;

        if v_product.stock < v_needed then
          raise exception 'Estoque insuficiente pro kit "%": falta "%"', v_kit.name, v_product.name;
        end if;

        update public.products set stock = stock - v_needed where id = v_product.id;
      end loop;

      v_subtotal := v_subtotal + (v_kit.price * v_quantity);
      v_order_items := v_order_items || jsonb_build_object(
        'name', 'Kit: ' || v_kit.name,
        'price', v_kit.price,
        'quantity', v_quantity,
        'kit_id', v_kit.id
      );
    else
      select id, name, price, stock into v_product
      from public.products
      where id = (v_item->>'product_id')::uuid
        and store_id = p_store_id
        and active = true
      for update;

      if not found then
        raise exception 'Um dos produtos não está mais disponível';
      end if;

      if v_product.stock < v_quantity then
        raise exception 'Estoque insuficiente para "%": só tem % disponível', v_product.name, v_product.stock;
      end if;

      update public.products set stock = stock - v_quantity where id = v_product.id;

      v_subtotal := v_subtotal + (v_product.price * v_quantity);
      v_order_items := v_order_items || jsonb_build_object(
        'name', v_product.name,
        'price', v_product.price,
        'quantity', v_quantity,
        'product_id', v_product.id
      );
    end if;
  end loop;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    select * into v_coupon from public.coupons
    where store_id = p_store_id and lower(code) = lower(trim(p_coupon_code)) and active = true
    for update;

    if not found then
      raise exception 'Cupom inválido';
    end if;

    if v_coupon.expires_at is not null and v_coupon.expires_at < now() then
      raise exception 'Esse cupom expirou';
    end if;

    if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
      raise exception 'Esse cupom já atingiu o limite de uso';
    end if;

    if v_subtotal < v_coupon.min_order_value then
      raise exception 'Esse cupom exige um pedido mínimo de R$ %', v_coupon.min_order_value;
    end if;

    if v_coupon.discount_type = 'percent' then
      v_discount := round(v_subtotal * v_coupon.discount_value / 100, 2);
    else
      v_discount := v_coupon.discount_value;
    end if;

    if v_discount > v_subtotal then
      v_discount := v_subtotal;
    end if;

    update public.coupons set used_count = used_count + 1 where id = v_coupon.id;
  end if;

  v_total := v_subtotal - v_discount;

  insert into public.orders (store_id, customer_name, customer_phone, items, total, coupon_code, discount_amount)
  values (
    p_store_id,
    trim(p_customer_name),
    trim(p_customer_phone),
    v_order_items,
    v_total,
    case when v_discount > 0 then upper(trim(p_coupon_code)) else null end,
    v_discount
  )
  returning id into v_order_id;

  return query select v_order_id, v_total, v_discount;
end;
$$;

grant execute on function public.checkout(uuid, text, text, jsonb, text) to anon, authenticated;
