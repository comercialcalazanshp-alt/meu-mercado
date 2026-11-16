-- Meu Mercado — v150.
-- A v149 criou update_credit_customer(), que troca nome e WhatsApp de um cliente
-- do crediário e leva junto o histórico de pedidos (orders.customer_name /
-- customer_phone). Só que guard_order_delivery_fields() (a trava que impede quem
-- está logado de mexer em itens, valores, pagamento, nome e telefone de um
-- pedido já feito) revertia essas duas colunas em silêncio — o cliente mudava,
-- mas as vendas dele ficavam com o nome/número antigos e sumiam do histórico.
--
-- Aqui a trava continua IGUAL pra tudo, com uma única exceção: nome e telefone
-- do cliente no pedido podem mudar quando update_credit_customer() liga o sinal
-- transitório "mm.editing_customer" (vale só dentro dessa operação; quem chama
-- a função já foi conferido contra my_store_ids). Itens, total, desconto,
-- forma de pagamento etc. continuam travados.

create or replace function public.guard_order_delivery_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_is_owner boolean;
  v_my_member_id uuid;
  v_editing_customer boolean := coalesce(current_setting('mm.editing_customer', true), '') = 'on';
begin
  if auth.uid() is null then
    return new;
  end if;

  new.total := old.total;
  new.discount_amount := old.discount_amount;
  new.coupon_code := old.coupon_code;
  new.delivery_fee := old.delivery_fee;
  new.scratch_discount := old.scratch_discount;
  new.items := old.items;
  new.payment_method := old.payment_method;
  new.payment_split := old.payment_split;
  new.channel := old.channel;
  if not v_editing_customer then
    new.customer_name := old.customer_name;
    new.customer_phone := old.customer_phone;
  end if;
  new.delivery_address := old.delivery_address;
  new.pix_qr_code_text := old.pix_qr_code_text;
  new.pix_qr_code_image := old.pix_qr_code_image;
  new.pagbank_order_id := old.pagbank_order_id;
  new.pix_paid_at := old.pix_paid_at;
  new.pix_end_to_end_id := old.pix_end_to_end_id;
  new.pix_refunded_at := old.pix_refunded_at;
  new.card_paid_at := old.card_paid_at;
  new.card_last_digits := old.card_last_digits;
  new.card_brand := old.card_brand;
  new.card_charging_at := old.card_charging_at;
  new.cashback_earned := old.cashback_earned;
  new.cashback_used := old.cashback_used;
  new.cashback_credited_at := old.cashback_credited_at;
  new.cashback_reversed_at := old.cashback_reversed_at;
  new.referral_bonus_earned := old.referral_bonus_earned;
  new.referrer_customer_id := old.referrer_customer_id;

  select (owner_id = auth.uid()) into v_caller_is_owner from public.stores where id = new.store_id;

  if not coalesce(v_caller_is_owner, false) then
    new.delivery_payout_settled := old.delivery_payout_settled;
  end if;

  if new.status = 'entregue' and old.status is distinct from 'entregue' then
    select sm.id into v_my_member_id
    from public.store_members sm
    where sm.store_id = new.store_id
      and sm.role = 'entregador'
      and lower(sm.email) = lower(coalesce(auth.email(), ''))
    limit 1;
    new.delivered_by := v_my_member_id;
  else
    new.delivered_by := old.delivered_by;
  end if;

  return new;
end;
$$;

-- update_credit_customer(): igual à v149, com o sinal ligado só em volta das
-- duas atualizações de pedidos.
create or replace function public.update_credit_customer(
  p_customer_id uuid,
  p_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cc record;
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := trim(coalesce(p_phone, ''));
begin
  select * into v_cc
  from public.credit_customers
  where id = p_customer_id and store_id in (select public.my_store_ids());
  if not found then
    raise exception 'Cliente não encontrado';
  end if;

  if v_name = '' then
    raise exception 'Digite o nome do cliente.';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Nome muito grande (máximo 80 letras).';
  end if;
  if v_phone = '' then
    raise exception 'Digite o WhatsApp do cliente.';
  end if;
  if char_length(v_phone) > 60 then
    raise exception 'WhatsApp inválido.';
  end if;

  if v_phone <> v_cc.phone then
    if exists (
      select 1 from public.credit_customers
      where store_id = v_cc.store_id and phone = v_phone and id <> v_cc.id
    ) then
      raise exception 'Já existe outro cliente com esse WhatsApp.';
    end if;

    if exists (
      select 1 from public.customers
      where store_id = v_cc.store_id and phone = v_cc.phone
    ) then
      raise exception 'Esse cliente tem conta no site com esse número, então o WhatsApp não pode ser trocado por aqui.';
    end if;

    update public.credit_customers set phone = v_phone where id = v_cc.id;

    delete from public.customer_notes where store_id = v_cc.store_id and phone = v_phone;
    update public.customer_notes set phone = v_phone
    where store_id = v_cc.store_id and phone = v_cc.phone;

    perform set_config('mm.editing_customer', 'on', true);
    update public.orders set customer_phone = v_phone
    where store_id = v_cc.store_id and customer_phone = v_cc.phone and customer_id is null;
    perform set_config('mm.editing_customer', 'off', true);
  end if;

  update public.credit_customers set name = v_name where id = v_cc.id;

  perform set_config('mm.editing_customer', 'on', true);
  update public.orders set customer_name = v_name
  where store_id = v_cc.store_id and customer_phone = v_phone and customer_id is null;
  perform set_config('mm.editing_customer', 'off', true);
end;
$$;

revoke all on function public.update_credit_customer(uuid, text, text) from public, anon;
grant execute on function public.update_credit_customer(uuid, text, text) to authenticated;
