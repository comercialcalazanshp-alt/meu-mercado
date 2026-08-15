-- Meu Mercado — v63.
-- "Ofertas do dia" nunca eram realmente diárias: on_offer/offer_price
-- ficavam ligados até o dono lembrar de desmarcar manualmente. Adiciona um
-- prazo opcional (offer_ends_at) e ensina checkout()/pdv_sale() a tratar a
-- oferta como vencida sozinha depois desse horário — mesmo padrão que
-- banners/kits já usam pra agendamento, só que aqui não existe uma "trava"
-- de RLS pública equivalente (produto tem seu próprio preço calculado
-- dentro da função, não é um simples SELECT), então o corte tem que estar
-- dentro das duas funções que decidem o preço de verdade.
alter table public.products
  add column if not exists offer_ends_at timestamptz;

create or replace function public.checkout(
  p_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_coupon_code text default null,
  p_referral_code text default null,
  p_use_cashback boolean default false,
  p_birthday date default null,
  p_neighborhood_id uuid default null,
  p_delivery_address text default null
)
returns table (
  order_id uuid,
  total numeric,
  discount numeric,
  cashback_earned numeric,
  cashback_used numeric,
  referral_code text,
  referral_bonus_earned numeric,
  delivery_fee numeric,
  scratch_discount numeric
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item jsonb;
  v_component jsonb;
  v_product record;
  v_kit record;
  v_quantity int;
  v_needed int;
  v_unit_price numeric;
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
  v_scratch record;
  v_scratch_discount numeric := 0;
  v_auth_uid uuid := auth.uid();
  v_offer_active boolean;
begin
  if v_auth_uid is not null and not exists (select 1 from public.customer_profiles where id = v_auth_uid) then
    v_auth_uid := null;
  end if;

  if p_customer_name is null or trim(p_customer_name) = '' then
    raise exception 'Nome do cliente é obrigatório';
  end if;
  if p_customer_phone is null or trim(p_customer_phone) = '' then
    raise exception 'WhatsApp do cliente é obrigatório';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Carrinho vazio';
  end if;
  if p_neighborhood_id is not null and (p_delivery_address is null or trim(p_delivery_address) = '') then
    raise exception 'Endereço de entrega é obrigatório';
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
             price_wholesale, wholesale_min_qty, on_offer, offer_price, offer_ends_at
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

      v_offer_active := v_product.on_offer and v_product.offer_price is not null
        and (v_product.offer_ends_at is null or v_product.offer_ends_at > now());

      if v_offer_active then
        v_line_total := v_product.offer_price * v_quantity;
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

      v_unit_price := case when v_offer_active then v_product.offer_price else v_product.price end;

      v_subtotal := v_subtotal + v_line_total;
      v_order_items := v_order_items || jsonb_build_object(
        'name', v_product.name,
        'price', v_unit_price,
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

    if v_coupon.single_use_per_customer and exists (
      select 1 from public.orders
      where store_id = p_store_id
        and customer_phone = v_phone
        and upper(coupon_code) = upper(v_coupon.code)
    ) then
      raise exception 'Você já usou esse cupom antes';
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

  if v_auth_uid is not null then
    select * into v_scratch from public.scratch_cards
      where store_id = p_store_id
        and profile_id = v_auth_uid
        and redeemed = false
        and now() - created_at <= interval '48 hours'
      order by created_at desc
      limit 1
      for update;

    if found then
      v_scratch_discount := round(v_subtotal * v_scratch.discount_percent / 100, 2);
      if v_scratch_discount > v_subtotal - v_discount then
        v_scratch_discount := greatest(v_subtotal - v_discount, 0);
      end if;
      v_discount := v_discount + v_scratch_discount;
      update public.scratch_cards set redeemed = true where id = v_scratch.id;
    end if;
  end if;

  v_total := v_subtotal - v_discount;

  select * into v_customer from public.customers
    where store_id = p_store_id and phone = v_phone
    for update;

  if not found then
    insert into public.customers (store_id, phone, name, referral_code, birthday, profile_id)
    values (
      p_store_id,
      v_phone,
      trim(p_customer_name),
      upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
      p_birthday,
      v_auth_uid
    )
    returning * into v_customer;
  else
    if v_customer.birthday is null and p_birthday is not null then
      update public.customers set birthday = p_birthday where id = v_customer.id;
    end if;
    if v_customer.name is distinct from trim(p_customer_name) then
      update public.customers set name = trim(p_customer_name) where id = v_customer.id;
    end if;
    if v_auth_uid is not null and v_customer.profile_id is distinct from v_auth_uid then
      update public.customers set profile_id = v_auth_uid where id = v_customer.id;
    end if;
  end if;

  if v_auth_uid is not null and p_referral_code is not null and trim(p_referral_code) <> '' and v_customer.referred_by is null then
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

  if v_auth_uid is not null and p_use_cashback and v_customer.cashback_balance > 0 and v_total > 0 then
    v_cashback_used := least(v_customer.cashback_balance, v_total);
    v_total := v_total - v_cashback_used;
    update public.customers set cashback_balance = cashback_balance - v_cashback_used where id = v_customer.id;
  end if;

  if v_auth_uid is not null and v_store.cashback_percent > 0 and v_total > 0 then
    v_cashback_earned := round(v_total * v_store.cashback_percent / 100, 2);
    update public.customers set cashback_balance = cashback_balance + v_cashback_earned where id = v_customer.id;
  end if;

  v_total := v_total + v_delivery_fee;

  insert into public.orders (
    store_id, customer_name, customer_phone, items, total, coupon_code, discount_amount,
    customer_id, cashback_earned, cashback_used, neighborhood_name, delivery_fee, scratch_discount,
    delivery_address
  )
  values (
    p_store_id,
    trim(p_customer_name),
    v_phone,
    v_order_items,
    v_total,
    case when v_discount - v_scratch_discount > 0 then upper(trim(p_coupon_code)) else null end,
    v_discount,
    v_customer.id,
    v_cashback_earned,
    v_cashback_used,
    v_neighborhood_name,
    v_delivery_fee,
    v_scratch_discount,
    nullif(trim(p_delivery_address), '')
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
    v_delivery_fee,
    v_scratch_discount;
end;
$function$;

create or replace function public.pdv_sale(
  p_store_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text default 'Cliente balcão'::text,
  p_customer_phone text default null::text,
  p_payments jsonb default null::jsonb,
  p_discount_amount numeric default 0
)
returns table (order_id uuid, total numeric)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item jsonb;
  v_component record;
  v_kit record;
  v_product record;
  v_quantity numeric;
  v_needed numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_customer_id uuid;
  v_is_split boolean := p_payments is not null and jsonb_array_length(p_payments) > 1;
  v_pay jsonb;
  v_pay_sum numeric := 0;
  v_fiado_amount numeric := 0;
  v_discount numeric := coalesce(p_discount_amount, 0);
  v_combo_sets numeric;
  v_offer_active boolean;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  if p_payment_method not in ('dinheiro', 'pix', 'cartao', 'fiado', 'dividido') then
    raise exception 'Forma de pagamento inválida';
  end if;

  if v_discount < 0 then
    raise exception 'Desconto inválido';
  end if;

  if v_is_split then
    for v_pay in select * from jsonb_array_elements(p_payments)
    loop
      if (v_pay->>'method') not in ('dinheiro', 'pix', 'cartao', 'fiado') then
        raise exception 'Forma de pagamento inválida na divisão';
      end if;
      if (v_pay->>'amount')::numeric <= 0 then
        raise exception 'Valor inválido na divisão de pagamento';
      end if;
      v_pay_sum := v_pay_sum + (v_pay->>'amount')::numeric;
      if v_pay->>'method' = 'fiado' then
        v_fiado_amount := v_fiado_amount + (v_pay->>'amount')::numeric;
      end if;
    end loop;

    if v_fiado_amount > 0 and (p_customer_phone is null or trim(p_customer_phone) = '') then
      raise exception 'A parte no crediário precisa do WhatsApp do cliente';
    end if;
  else
    if p_payment_method = 'fiado' and (p_customer_phone is null or trim(p_customer_phone) = '') then
      raise exception 'Venda fiado precisa do WhatsApp do cliente';
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Carrinho vazio';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::numeric;
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
        select product_id, quantity from public.kit_items where kit_id = v_kit.id
      loop
        select id, name, stock into v_product
        from public.products
        where id = v_component.product_id
          and store_id = p_store_id
        for update;

        if not found then
          raise exception 'Um produto do kit "%" não está mais disponível', v_kit.name;
        end if;

        v_needed := v_component.quantity * v_quantity;

        if v_product.stock < v_needed then
          raise exception 'Estoque insuficiente pro kit "%": falta "%"', v_kit.name, v_product.name;
        end if;

        update public.products set stock = stock - v_needed where id = v_product.id;
      end loop;

      v_line_total := v_kit.price * v_quantity;
      v_total := v_total + v_line_total;
      v_order_items := v_order_items || jsonb_build_object(
        'name', 'Kit: ' || v_kit.name,
        'price', v_kit.price,
        'quantity', v_quantity,
        'kit_id', v_kit.id,
        'line_total', v_line_total
      );
    else
      select id, name, price, stock, promo_buy_qty, promo_pay_qty,
             price_wholesale, wholesale_min_qty, price_fiado, on_offer, offer_price, offer_ends_at, sold_by_weight
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

      v_offer_active := v_product.on_offer and v_product.offer_price is not null
        and (v_product.offer_ends_at is null or v_product.offer_ends_at > now());

      if not v_is_split and p_payment_method = 'fiado' and v_product.price_fiado is not null then
        v_line_total := v_product.price_fiado * v_quantity;
        v_unit_price := v_product.price_fiado;
      elsif v_offer_active then
        v_line_total := v_product.offer_price * v_quantity;
        v_unit_price := v_product.offer_price;
      elsif v_product.price_wholesale is not null and v_quantity >= v_product.wholesale_min_qty then
        v_line_total := v_product.price_wholesale * v_quantity;
        v_unit_price := v_product.price_wholesale;
      elsif not v_product.sold_by_weight and v_product.promo_buy_qty is not null and v_quantity >= v_product.promo_buy_qty then
        v_combo_sets := trunc(v_quantity / v_product.promo_buy_qty);
        v_line_total := (
          v_combo_sets * v_product.promo_pay_qty
          + (v_quantity - v_combo_sets * v_product.promo_buy_qty)
        ) * v_product.price;
        v_unit_price := v_product.price;
      else
        v_line_total := v_product.price * v_quantity;
        v_unit_price := v_product.price;
      end if;

      v_total := v_total + v_line_total;
      v_order_items := v_order_items || jsonb_build_object(
        'name', v_product.name,
        'price', v_unit_price,
        'quantity', v_quantity,
        'product_id', v_product.id,
        'line_total', v_line_total,
        'sold_by_weight', v_product.sold_by_weight
      );
    end if;
  end loop;

  if v_discount > v_total then
    raise exception 'O desconto não pode ser maior que o total da venda';
  end if;

  v_total := v_total - v_discount;

  if v_is_split and round(v_pay_sum, 2) <> round(v_total, 2) then
    raise exception 'A soma das formas de pagamento (%) não bate com o total (%)', v_pay_sum, v_total;
  end if;

  insert into public.orders (
    store_id, customer_name, customer_phone, items, total, status, channel,
    payment_method, payment_split, discount_amount
  )
  values (
    p_store_id,
    coalesce(nullif(trim(p_customer_name), ''), 'Cliente balcão'),
    coalesce(nullif(trim(p_customer_phone), ''), 'balcão'),
    v_order_items,
    v_total,
    'entregue',
    'balcao',
    case when v_is_split then 'dividido' else p_payment_method end,
    case when v_is_split then p_payments else null end,
    v_discount
  )
  returning id into v_order_id;

  if (v_is_split and v_fiado_amount > 0) or (not v_is_split and p_payment_method = 'fiado') then
    insert into public.credit_customers (store_id, name, phone)
    values (p_store_id, coalesce(nullif(trim(p_customer_name), ''), 'Cliente balcão'), trim(p_customer_phone))
    on conflict (store_id, phone) do update set name = excluded.name
    returning id into v_customer_id;

    insert into public.credit_transactions (customer_id, type, amount, note)
    values (
      v_customer_id,
      'venda',
      case when v_is_split then v_fiado_amount else v_total end,
      'Venda no balcão (PDV)'
    );
  end if;

  return query select v_order_id, v_total;
end;
$function$;
