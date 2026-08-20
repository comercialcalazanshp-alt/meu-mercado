-- Meu Mercado — v92.
-- Achado sério revisando o checkout como especialista financeiro +
-- consumidor: checkout() nunca grava payment_method no pedido (a coluna
-- existe mas o INSERT não a preenche) — então o painel de Entregas
-- (paymentInfo, painel/entregas/page.tsx) nunca reconhece um pedido como
-- "pago no site", e sempre manda o entregador cobrar na entrega, mesmo
-- quando o cliente já pagou via Pix/cartão. Confirmado direto no banco:
-- 17 de 22 pedidos com payment_method nulo.
--
-- Além disso, checkout_hub() (v80) cria a comissão do Hub ('venda' em
-- affiliate_settlement_transactions) NA HORA que o pedido é criado, antes
-- de qualquer pagamento Pix/cartão ser confirmado — um pedido que falha o
-- pagamento e o cliente nunca resolve por WhatsApp continua contando como
-- faturamento/comissão real pra sempre.
--
-- Essa migração: adiciona p_payment_method em checkout() e checkout_hub()
-- (grava o método escolhido no pedido); e faz checkout_hub() só criar a
-- comissão na hora pra pagamento "dinheiro" (sem confirmação assíncrona)
-- — pra pix/cartão, a comissão passa a ser criada só quando o webhook
-- confirma o pagamento de verdade (ver syncHubOrderPayment no código).

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
  p_delivery_address text default null,
  p_recipe_id uuid default null,
  p_payment_method text default null
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
  scratch_discount numeric,
  eta_min_minutes int,
  eta_max_minutes int
)
language plpgsql
security definer
set search_path to 'public'
as $$
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
  v_eta_min int := null;
  v_eta_max int := null;
  v_scratch record;
  v_scratch_discount numeric := 0;
  v_auth_uid uuid := auth.uid();
  v_offer_active boolean;
  v_recipe_id uuid := null;
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

  if p_recipe_id is not null and exists (select 1 from public.recipes where id = p_recipe_id and store_id = p_store_id) then
    v_recipe_id := p_recipe_id;
  end if;

  if p_neighborhood_id is not null then
    select n.id, n.name, n.fee, n.eta_min_minutes, n.eta_max_minutes into v_neighborhood
    from public.neighborhoods n
    where n.id = p_neighborhood_id and n.store_id = p_store_id and n.active = true;

    if not found then
      raise exception 'Esse bairro não está mais disponível';
    end if;

    v_delivery_fee := v_neighborhood.fee;
    v_neighborhood_name := v_neighborhood.name;
    v_eta_min := v_neighborhood.eta_min_minutes;
    v_eta_max := v_neighborhood.eta_max_minutes;
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
    delivery_address, recipe_id, eta_min_minutes, eta_max_minutes, payment_method
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
    nullif(trim(p_delivery_address), ''),
    v_recipe_id,
    v_eta_min,
    v_eta_max,
    coalesce(nullif(trim(p_payment_method), ''), 'dinheiro')
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
    v_scratch_discount,
    v_eta_min,
    v_eta_max;
end;
$$;

grant execute on function public.checkout(uuid, text, text, jsonb, text, text, boolean, date, uuid, text, uuid, text) to anon, authenticated;

-- checkout_hub (v80) chamava checkout() sem informar o método de
-- pagamento, e criava a comissão do Hub na hora — antes do Pix/cartão
-- serem confirmados. Agora recebe p_payment_method, repassa pra cada
-- checkout() do carrinho, e só cria a comissão na hora pra "dinheiro"
-- (sem confirmação assíncrona) — pix/cartão passam a gerar a comissão só
-- quando o webhook confirma o pagamento (syncHubOrderPayment, no código).
create or replace function public.checkout_hub(
  p_hub_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_carts jsonb,
  p_use_cashback boolean default false,
  p_birthday date default null,
  p_referral_code text default null,
  p_payment_method text default null
)
returns table (
  hub_order_id uuid,
  store_id uuid,
  order_id uuid,
  total numeric,
  discount numeric,
  delivery_fee numeric,
  eta_min_minutes int,
  eta_max_minutes int
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hub_order_id uuid;
  v_cart jsonb;
  v_store_id uuid;
  v_result record;
  v_is_first boolean := true;
begin
  if p_customer_name is null or trim(p_customer_name) = '' then
    raise exception 'Nome do cliente é obrigatório';
  end if;
  if p_customer_phone is null or trim(p_customer_phone) = '' then
    raise exception 'WhatsApp do cliente é obrigatório';
  end if;
  if p_carts is null or jsonb_array_length(p_carts) = 0 then
    raise exception 'Carrinho vazio';
  end if;

  if not exists (select 1 from public.stores where id = p_hub_store_id) then
    raise exception 'Loja não encontrada';
  end if;

  insert into public.hub_orders (hub_store_id, customer_name, customer_phone)
  values (p_hub_store_id, trim(p_customer_name), trim(p_customer_phone))
  returning id into v_hub_order_id;

  for v_cart in select * from jsonb_array_elements(p_carts)
  loop
    v_store_id := (v_cart->>'store_id')::uuid;

    if v_store_id <> p_hub_store_id and not exists (
      select 1 from public.affiliate_partnerships ap
      where ap.hub_store_id = p_hub_store_id and ap.module_store_id = v_store_id and ap.active
    ) then
      raise exception 'Uma das lojas do carrinho não pertence a este hub';
    end if;

    select * into v_result from public.checkout(
      v_store_id,
      p_customer_name,
      p_customer_phone,
      v_cart->'items',
      v_cart->>'coupon_code',
      case when v_is_first then p_referral_code else null end,
      p_use_cashback,
      p_birthday,
      nullif(v_cart->>'neighborhood_id', '')::uuid,
      v_cart->>'delivery_address',
      null,
      p_payment_method
    );
    v_is_first := false;

    update public.orders set hub_order_id = v_hub_order_id where id = v_result.order_id;

    -- Só cria a comissão na hora pra "dinheiro" (cobrança na entrega, sem
    -- confirmação assíncrona pra esperar). Pix/cartão ficam sem comissão
    -- até o pagamento ser confirmado de verdade — evita contar venda que
    -- nunca foi paga.
    if coalesce(nullif(trim(p_payment_method), ''), 'dinheiro') = 'dinheiro' then
      insert into public.affiliate_settlement_transactions (partnership_id, type, amount, order_id, note)
      select ap.id, 'venda', round(v_result.total * (100 - ap.commission_percent) / 100, 2), v_result.order_id,
        'Venda via vitrine do hub'
      from public.affiliate_partnerships ap
      where ap.hub_store_id = p_hub_store_id
        and ap.module_store_id = v_store_id
        and ap.active
        and round(v_result.total * (100 - ap.commission_percent) / 100, 2) > 0;
    end if;

    insert into public.affiliate_order_stops (order_id, store_id, address, lat, lng)
    select v_result.order_id, s.id, s.address, s.lat, s.lng
    from public.stores s
    where s.id = v_store_id and s.address is not null and trim(s.address) <> '';

    return query select v_hub_order_id, v_store_id, v_result.order_id, v_result.total,
      v_result.discount, v_result.delivery_fee, v_result.eta_min_minutes, v_result.eta_max_minutes;
  end loop;

  update public.hub_orders
  set total = (select coalesce(sum(o.total), 0) from public.orders o where o.hub_order_id = v_hub_order_id)
  where id = v_hub_order_id;
end;
$$;

grant execute on function public.checkout_hub(uuid, text, text, jsonb, boolean, date, text, text) to anon, authenticated;
