-- Meu Mercado — v22.
-- Campos de produto que já existiam no Comercial Calazans e faltavam aqui:
-- código de barras, preço a prazo (fiado), preço de atacado (a partir de
-- uma quantidade mínima) e alerta de estoque baixo.

alter table products add column if not exists barcode text;
alter table products add column if not exists price_fiado numeric;
alter table products add column if not exists price_wholesale numeric;
alter table products add column if not exists wholesale_min_qty integer;
alter table products add column if not exists stock_alert_threshold numeric not null default 5;

alter table products drop constraint if exists products_wholesale_check;
alter table products add constraint products_wholesale_check
  check (
    (price_wholesale is null and wholesale_min_qty is null)
    or (price_wholesale is not null and wholesale_min_qty is not null and wholesale_min_qty > 0)
  );

-- checkout() (site): mesma lógica de preço do leve-mais-pague-menos (v20),
-- mas agora com atacado. Prioridade quando os dois se aplicam: atacado
-- primeiro (é o desconto "mais simples", pensado pra quantidade maior),
-- depois leve/pague, depois preço normal.
drop function if exists public.checkout(uuid, text, text, jsonb, text, text, boolean, date, uuid);

create or replace function public.checkout(
  p_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_coupon_code text default null,
  p_referral_code text default null,
  p_use_cashback boolean default false,
  p_birthday date default null,
  p_neighborhood_id uuid default null
)
returns table (
  order_id uuid,
  total numeric,
  discount numeric,
  cashback_earned numeric,
  cashback_used numeric,
  referral_code text,
  referral_bonus_earned numeric,
  delivery_fee numeric
)
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
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_coupon record;
  v_discount numeric := 0;
  v_total numeric;
  v_store record;
  v_customer record;
  v_referrer record;
  v_cashback_used numeric := 0;
  v_cashback_earned numeric := 0;
  v_referral_bonus_earned numeric := 0;
  v_phone text;
  v_neighborhood record;
  v_delivery_fee numeric := 0;
  v_neighborhood_name text := null;
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

  v_phone := trim(p_customer_phone);

  select cashback_percent, referral_bonus into v_store from public.stores where id = p_store_id;
  if not found then
    raise exception 'Loja não encontrada';
  end if;

  if p_neighborhood_id is not null then
    select id, name, fee into v_neighborhood
    from public.neighborhoods
    where id = p_neighborhood_id and store_id = p_store_id and active = true;

    if not found then
      raise exception 'Esse bairro não está mais disponível';
    end if;

    v_delivery_fee := v_neighborhood.fee;
    v_neighborhood_name := v_neighborhood.name;
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
      select id, name, price, stock, promo_buy_qty, promo_pay_qty,
             price_wholesale, wholesale_min_qty
        into v_product
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

      if v_product.price_wholesale is not null and v_quantity >= v_product.wholesale_min_qty then
        v_line_total := v_product.price_wholesale * v_quantity;
      elsif v_product.promo_buy_qty is not null and v_quantity >= v_product.promo_buy_qty then
        v_line_total := (
          (v_quantity / v_product.promo_buy_qty) * v_product.promo_pay_qty
          + (v_quantity % v_product.promo_buy_qty)
        ) * v_product.price;
      else
        v_line_total := v_product.price * v_quantity;
      end if;

      v_subtotal := v_subtotal + v_line_total;
      v_order_items := v_order_items || jsonb_build_object(
        'name', v_product.name,
        'price', v_product.price,
        'quantity', v_quantity,
        'product_id', v_product.id,
        'line_total', v_line_total
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

  select * into v_customer from public.customers
    where store_id = p_store_id and phone = v_phone
    for update;

  if not found then
    insert into public.customers (store_id, phone, name, referral_code, birthday)
    values (
      p_store_id,
      v_phone,
      trim(p_customer_name),
      upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
      p_birthday
    )
    returning * into v_customer;
  else
    if v_customer.birthday is null and p_birthday is not null then
      update public.customers set birthday = p_birthday where id = v_customer.id;
    end if;
    if v_customer.name is distinct from trim(p_customer_name) then
      update public.customers set name = trim(p_customer_name) where id = v_customer.id;
    end if;
  end if;

  if p_referral_code is not null and trim(p_referral_code) <> '' and v_customer.referred_by is null then
    select * into v_referrer from public.customers
      where store_id = p_store_id and customers.referral_code = upper(trim(p_referral_code)) and id <> v_customer.id
      for update;

    if found then
      update public.customers set referred_by = v_referrer.id where id = v_customer.id;
      if v_store.referral_bonus > 0 then
        update public.customers set cashback_balance = cashback_balance + v_store.referral_bonus
          where id in (v_customer.id, v_referrer.id);
        v_referral_bonus_earned := v_store.referral_bonus;
      end if;
    end if;
  end if;

  select cashback_balance into v_customer.cashback_balance
    from public.customers where id = v_customer.id;

  if p_use_cashback and v_customer.cashback_balance > 0 and v_total > 0 then
    v_cashback_used := least(v_customer.cashback_balance, v_total);
    v_total := v_total - v_cashback_used;
    update public.customers set cashback_balance = cashback_balance - v_cashback_used where id = v_customer.id;
  end if;

  if v_store.cashback_percent > 0 and v_total > 0 then
    v_cashback_earned := round(v_total * v_store.cashback_percent / 100, 2);
    update public.customers set cashback_balance = cashback_balance + v_cashback_earned where id = v_customer.id;
  end if;

  v_total := v_total + v_delivery_fee;

  insert into public.orders (
    store_id, customer_name, customer_phone, items, total, coupon_code, discount_amount,
    customer_id, cashback_earned, cashback_used, neighborhood_name, delivery_fee
  )
  values (
    p_store_id,
    trim(p_customer_name),
    v_phone,
    v_order_items,
    v_total,
    case when v_discount > 0 then upper(trim(p_coupon_code)) else null end,
    v_discount,
    v_customer.id,
    v_cashback_earned,
    v_cashback_used,
    v_neighborhood_name,
    v_delivery_fee
  )
  returning id into v_order_id;

  return query select
    v_order_id,
    v_total,
    v_discount,
    v_cashback_earned,
    v_cashback_used,
    v_customer.referral_code,
    v_referral_bonus_earned,
    v_delivery_fee;
end;
$$;

grant execute on function public.checkout(uuid, text, text, jsonb, text, text, boolean, date, uuid) to anon, authenticated;

-- pdv_sale(): mesma prioridade atacado > leve/pague > normal, mas se a
-- venda for fiado e o produto tiver preço a prazo, esse preço vale sozinho
-- (sem empilhar com atacado/promoção — é uma tabela de preço à parte).
create or replace function public.pdv_sale(
  p_store_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text default 'Cliente balcão',
  p_customer_phone text default null
)
returns table (order_id uuid, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_product record;
  v_quantity int;
  v_line_total numeric;
  v_total numeric := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_customer_id uuid;
begin
  if not exists (select 1 from stores where id = p_store_id and owner_id = auth.uid()) then
    raise exception 'Loja não encontrada';
  end if;

  if p_payment_method not in ('dinheiro', 'pix', 'cartao', 'fiado') then
    raise exception 'Forma de pagamento inválida';
  end if;

  if p_payment_method = 'fiado' and (p_customer_phone is null or trim(p_customer_phone) = '') then
    raise exception 'Venda fiado precisa do WhatsApp do cliente';
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

    select id, name, price, stock, promo_buy_qty, promo_pay_qty,
           price_wholesale, wholesale_min_qty, price_fiado
      into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid
      and store_id = p_store_id
    for update;

    if not found then
      raise exception 'Um dos produtos não foi encontrado';
    end if;

    if v_product.stock < v_quantity then
      raise exception 'Estoque insuficiente para "%": só tem % disponível', v_product.name, v_product.stock;
    end if;

    update public.products set stock = stock - v_quantity where id = v_product.id;

    if p_payment_method = 'fiado' and v_product.price_fiado is not null then
      v_line_total := v_product.price_fiado * v_quantity;
    elsif v_product.price_wholesale is not null and v_quantity >= v_product.wholesale_min_qty then
      v_line_total := v_product.price_wholesale * v_quantity;
    elsif v_product.promo_buy_qty is not null and v_quantity >= v_product.promo_buy_qty then
      v_line_total := (
        (v_quantity / v_product.promo_buy_qty) * v_product.promo_pay_qty
        + (v_quantity % v_product.promo_buy_qty)
      ) * v_product.price;
    else
      v_line_total := v_product.price * v_quantity;
    end if;

    v_total := v_total + v_line_total;
    v_order_items := v_order_items || jsonb_build_object(
      'name', v_product.name,
      'price', v_product.price,
      'quantity', v_quantity,
      'product_id', v_product.id,
      'line_total', v_line_total
    );
  end loop;

  insert into public.orders (store_id, customer_name, customer_phone, items, total, status, channel, payment_method)
  values (
    p_store_id,
    coalesce(nullif(trim(p_customer_name), ''), 'Cliente balcão'),
    coalesce(nullif(trim(p_customer_phone), ''), 'balcão'),
    v_order_items,
    v_total,
    'entregue',
    'balcao',
    p_payment_method
  )
  returning id into v_order_id;

  if p_payment_method = 'fiado' then
    insert into public.credit_customers (store_id, name, phone)
    values (p_store_id, coalesce(nullif(trim(p_customer_name), ''), 'Cliente balcão'), trim(p_customer_phone))
    on conflict (store_id, phone) do update set name = excluded.name
    returning id into v_customer_id;

    insert into public.credit_transactions (customer_id, type, amount, note)
    values (v_customer_id, 'venda', v_total, 'Venda no balcão (PDV)');
  end if;

  return query select v_order_id, v_total;
end;
$$;

grant execute on function public.pdv_sale(uuid, jsonb, text, text, text) to authenticated;
