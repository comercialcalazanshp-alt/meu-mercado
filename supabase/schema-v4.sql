-- Meu Mercado — v4.
-- Cupons de desconto: o dono cria um código (ex: BEMVINDO10), o cliente digita
-- na hora de fechar o pedido. Validação e desconto são calculados no banco
-- (dentro da própria função checkout), nunca no navegador — mesma lógica de
-- "nunca confiar no cliente" já usada pra preço/estoque no schema-v3.

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  code text not null,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric not null check (discount_value > 0),
  min_order_value numeric not null default 0,
  usage_limit integer,
  used_count integer not null default 0,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (store_id, code)
);

alter table coupons enable row level security;

drop policy if exists "dono gerencia cupons da propria loja" on coupons;
create policy "dono gerencia cupons da propria loja" on coupons for all
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

-- Sem policy pública de SELECT de propósito: o cliente nunca lista os cupons
-- da loja pela API, só valida um código específico através das funções abaixo.

alter table orders add column if not exists coupon_code text;
alter table orders add column if not exists discount_amount numeric not null default 0;

-- Preview: só calcula e mostra o desconto (não marca o cupom como usado) —
-- pro cliente ver "cupom aplicado, -R$X" antes de finalizar o pedido.
create or replace function public.preview_coupon(
  p_store_id uuid,
  p_code text,
  p_subtotal numeric
)
returns table (valid boolean, message text, discount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon record;
  v_discount numeric;
begin
  select * into v_coupon from public.coupons
  where store_id = p_store_id and lower(code) = lower(trim(p_code)) and active = true;

  if not found then
    return query select false, 'Cupom inválido'::text, 0::numeric;
    return;
  end if;

  if v_coupon.expires_at is not null and v_coupon.expires_at < now() then
    return query select false, 'Esse cupom expirou'::text, 0::numeric;
    return;
  end if;

  if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
    return query select false, 'Esse cupom já atingiu o limite de uso'::text, 0::numeric;
    return;
  end if;

  if p_subtotal < v_coupon.min_order_value then
    return query select false,
      ('Esse cupom exige um pedido mínimo de R$ ' || v_coupon.min_order_value::text)::text,
      0::numeric;
    return;
  end if;

  if v_coupon.discount_type = 'percent' then
    v_discount := round(p_subtotal * v_coupon.discount_value / 100, 2);
  else
    v_discount := v_coupon.discount_value;
  end if;

  if v_discount > p_subtotal then
    v_discount := p_subtotal;
  end if;

  return query select true, 'Cupom aplicado!'::text, v_discount;
end;
$$;

grant execute on function public.preview_coupon(uuid, text, numeric) to anon, authenticated;

-- Recria o checkout com suporte a cupom (assinatura muda, por isso dropa antes).
drop function if exists public.checkout(uuid, text, text, jsonb);

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
  v_product record;
  v_quantity int;
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
      'quantity', v_quantity
    );
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
