-- Meu Mercado — v86.
-- Quando um pedido de afiliado é cancelado, a comissão registrada (linha
-- 'venda' em affiliate_settlement_transactions, criada no checkout_hub)
-- continuava contando pro saldo do afiliado e pro faturamento da Hub —
-- nada revertia isso. Esse gatilho cria automaticamente uma linha
-- 'estorno' do mesmo valor assim que o pedido muda pra "cancelado",
-- reaproveitando o gatilho que já existe (apply_affiliate_settlement_transaction,
-- v73) pra subtrair do saldo — sem duplicar lógica de dinheiro em dois
-- lugares.
create or replace function public.reverse_affiliate_commission_on_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    insert into public.affiliate_settlement_transactions (partnership_id, type, amount, order_id, note)
    select st.partnership_id, 'estorno', st.amount, st.order_id, 'Estorno automático — pedido cancelado'
    from public.affiliate_settlement_transactions st
    where st.order_id = new.id
      and st.type = 'venda'
      and not exists (
        select 1 from public.affiliate_settlement_transactions est
        where est.order_id = new.id and est.type = 'estorno'
      );
  end if;
  return new;
end;
$$;

drop trigger if exists reverse_affiliate_commission_on_cancel_trigger on public.orders;
create trigger reverse_affiliate_commission_on_cancel_trigger
  after update on public.orders
  for each row execute function public.reverse_affiliate_commission_on_cancel();
