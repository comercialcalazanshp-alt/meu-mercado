-- Auditoria de segurança: checkout_hub() perdeu, numa reescrita anterior
-- (v97, só mudava a regra de quando lançar comissão), a checagem que
-- confirma que cada loja do carrinho realmente é o próprio hub ou um
-- afiliado ativo dele. Existia em v80/v92 ("Uma das lojas do carrinho não
-- pertence a este hub") e sumiu sem ser removida de propósito.
--
-- Sem essa checagem, qualquer chamada direta a checkout_hub() (bypassando
-- a vitrine, que só monta carrinho com afiliado de verdade) podia rotear
-- pedido — e desconto de estoque real — de QUALQUER loja da plataforma
-- através de um hub sem relação nenhuma com ela, sem repasse nenhum (a
-- comissão só lança quando existe uma affiliate_partnerships de verdade).
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

  insert into public.hub_orders (hub_store_id, customer_name, customer_phone, total)
  values (p_hub_store_id, trim(p_customer_name), trim(p_customer_phone), 0)
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

    -- Dinheiro e cartão na entrega são pagos na hora, sem confirmação
    -- assíncrona — lança a comissão já. Só pix/cartão online ficam sem
    -- comissão até o pagamento ser confirmado de verdade.
    if coalesce(nullif(trim(p_payment_method), ''), 'dinheiro') not in ('pix', 'cartao') then
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
