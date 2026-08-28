-- Meu Mercado — v126.
-- Base pro PDV funcionar offline: quando uma venda feita sem internet for
-- sincronizada depois, pode ser que o estoque já tenha mudado nesse meio
-- tempo (ex: alguém editou o estoque, ou uma venda pelo site consumiu o
-- que sobrava). Como a venda já aconteceu de verdade no balcão, ela tem
-- que ser aceita mesmo assim — só marca a venda pra o dono conferir esse
-- produto depois, em vez de travar a sincronização com "estoque
-- insuficiente" (que nem faz sentido pra algo que já foi vendido e pago).
--
-- p_allow_negative_stock só é usado pelo fluxo de sincronização offline —
-- uma venda normal, feita com internet, continua bloqueando estoque
-- insuficiente exatamente como sempre bloqueou.
alter table public.orders add column if not exists stock_conflict boolean not null default false;

drop function if exists public.pdv_sale(uuid, jsonb, text, text, text, jsonb, numeric);

create or replace function public.pdv_sale(
  p_store_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text default 'Cliente balcão',
  p_customer_phone text default null,
  p_payments jsonb default null,
  p_discount_amount numeric default 0,
  p_allow_negative_stock boolean default false
)
returns table (order_id uuid, total numeric, stock_conflict boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
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
  v_stock_conflict boolean := false;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_pdv_store_ids())) then
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
          if p_allow_negative_stock then
            v_stock_conflict := true;
          else
            raise exception 'Estoque insuficiente pro kit "%": falta "%"', v_kit.name, v_product.name;
          end if;
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
        if p_allow_negative_stock then
          v_stock_conflict := true;
        else
          raise exception 'Estoque insuficiente para "%": só tem % disponível', v_product.name, v_product.stock;
        end if;
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
    payment_method, payment_split, discount_amount, stock_conflict
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
    v_discount,
    v_stock_conflict
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

  return query select v_order_id, v_total, v_stock_conflict;
end;
$$;
