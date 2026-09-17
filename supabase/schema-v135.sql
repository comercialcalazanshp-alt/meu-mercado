-- Auditoria de segurança: acesso de equipe (caixa/entregador) estava mais
-- largo do que a própria tela promete ("Só entregas... sem ver fiado,
-- despesas, relatórios"). Duas políticas usavam my_pdv_store_ids(), que
-- devolve a loja pra QUALQUER cargo ativo (completo/caixa/entregador) —
-- sem checar qual é o cargo de verdade:
--   1) "equipe de entrega ve e atualiza pedidos da loja" (orders) deixava
--      um entregador (ou caixa) ler e ATUALIZAR todo pedido da loja, não só
--      os de entrega — nome, telefone, endereço, status de pagamento etc.
--      de qualquer pedido, inclusive vendas de balcão.
--   2) "equipe pdv busca clientes fiado" (credit_customers) deixava um
--      entregador ver o saldo devedor de todo cliente fiado da loja.
-- Corrige restringindo cada política ao cargo a que ela realmente se
-- destina.

drop policy if exists "equipe de entrega ve e atualiza pedidos da loja" on public.orders;
create policy "equipe de entrega ve e atualiza pedidos da loja" on public.orders for select
  using (
    store_id in (select public.my_pdv_store_ids())
    and public.get_my_role(store_id) = 'entregador'
  );

drop policy if exists "equipe de entrega atualiza status do pedido" on public.orders;
create policy "equipe de entrega atualiza status do pedido" on public.orders for update
  using (
    store_id in (select public.my_pdv_store_ids())
    and public.get_my_role(store_id) = 'entregador'
  )
  with check (
    store_id in (select public.my_pdv_store_ids())
    and public.get_my_role(store_id) = 'entregador'
  );

drop policy if exists "equipe pdv busca clientes fiado" on public.credit_customers;
create policy "equipe pdv busca clientes fiado" on public.credit_customers for select
  using (
    store_id in (select public.my_pdv_store_ids())
    and public.get_my_role(store_id) = 'caixa'
  );

-- Mesmo com a política de UPDATE agora restrita ao entregador, RLS é por
-- linha, não por coluna — nada impedia (antes) um UPDATE autenticado
-- (mesmo do dono) de reescrever valor, desconto, forma de pagamento, ou
-- fingir um pix/cartão como pago. Nenhuma tela do painel edita esses
-- campos por aqui de propósito (checkout grava na criação, o webhook de
-- pagamento confirma depois) — então trava tudo isso pra qualquer UPDATE
-- feito por um usuário logado (auth.uid() não nulo). O webhook de
-- pagamento roda com a chave de serviço, sem usuário logado (auth.uid()
-- nulo nesse caso), então continua funcionando normalmente.
create or replace function public.guard_order_delivery_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_is_owner boolean;
  v_my_member_id uuid;
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
  new.customer_name := old.customer_name;
  new.customer_phone := old.customer_phone;
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
