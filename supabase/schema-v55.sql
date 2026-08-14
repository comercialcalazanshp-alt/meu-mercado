-- Simplifica a raspadinha: como só cliente logado consegue raspar (já
-- validado dentro da função), não faz sentido pedir pra digitar o WhatsApp
-- de novo — usa a própria conta (profile_id) pra identificar. Isso também
-- corrige uma falha sutil: se a pessoa digitasse o telefone de um jeito na
-- raspadinha e de outro no checkout, o desconto não batia.
alter table public.scratch_cards
  add column if not exists profile_id uuid references public.customer_profiles(id) on delete cascade;

alter table public.scratch_cards
  alter column customer_phone drop not null;

alter table public.scratch_cards
  drop constraint if exists scratch_cards_store_id_customer_phone_week_start_key;

create unique index if not exists scratch_cards_store_profile_week_key
  on public.scratch_cards (store_id, profile_id, week_start);

create or replace function public.get_or_create_scratch_card(p_store_id uuid)
returns table (discount_percent numeric, redeemed boolean, already_existed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store record;
  v_auth_uid uuid := auth.uid();
  v_phone text;
  v_week date := date_trunc('week', now())::date;
  v_existing record;
  v_roll numeric;
  v_acc numeric := 0;
  v_odd jsonb;
  v_pick numeric := null;
begin
  if v_auth_uid is null or not exists (select 1 from public.customer_profiles where id = v_auth_uid) then
    raise exception 'Entre na sua conta de cliente pra raspar a raspadinha';
  end if;

  select scratch_enabled, scratch_odds into v_store from public.stores where id = p_store_id;
  if not found or not v_store.scratch_enabled then
    raise exception 'Raspadinha não está ativada nessa loja';
  end if;

  select * into v_existing from public.scratch_cards
    where store_id = p_store_id and profile_id = v_auth_uid and week_start = v_week;

  if found then
    return query select v_existing.discount_percent, v_existing.redeemed, true;
    return;
  end if;

  select phone into v_phone from public.customers
    where store_id = p_store_id and profile_id = v_auth_uid
    limit 1;

  v_roll := random() * 100;
  for v_odd in select * from jsonb_array_elements(v_store.scratch_odds)
  loop
    v_acc := v_acc + (v_odd->>'chance')::numeric;
    if v_pick is null and v_roll < v_acc then
      v_pick := (v_odd->>'discount')::numeric;
    end if;
  end loop;

  if v_pick is null then
    v_pick := 0;
  end if;

  insert into public.scratch_cards (store_id, customer_phone, profile_id, week_start, discount_percent)
  values (p_store_id, v_phone, v_auth_uid, v_week, v_pick);

  return query select v_pick, false, false;
end;
$$;

-- checkout() passa a casar o desconto da raspadinha pela conta logada
-- (profile_id) em vez do texto do telefone digitado, pelos mesmos motivos
-- acima.
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
             price_wholesale, wholesale_min_qty, on_offer, offer_price
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

      if v_product.on_offer and v_product.offer_price is not null then
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

      v_unit_price := case when v_product.on_offer and v_product.offer_price is not null
        then v_product.offer_price else v_product.price end;

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
        and week_start = date_trunc('week', now())::date
        and redeemed = false
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
