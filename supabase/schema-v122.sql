-- Meu Mercado — v122.
-- Duas correções no extrato de acerto com afiliado:
--
-- 1) A comissão da venda (syncHubOrderPayment) só evitava duplicar via
--    "select antes de inserir" — sem trava no banco, duas notificações de
--    webhook quase simultâneas pro mesmo pedido podiam passar as duas
--    pela checagem antes de qualquer inserir, duplicando a comissão. Um
--    índice único (só pra type='venda' com order_id preenchido) fecha
--    essa brecha de vez, na camada que garante de verdade.
--
-- 2) Devolver o Pix de um pedido (refund-pix) nunca desfazia a comissão
--    já lançada nem o cashback já creditado — o saldo a repassar pro
--    afiliado continuava contando uma venda que foi estornada de verdade,
--    e o cliente ficava com cashback de um pedido que foi devolvido.
create unique index if not exists idx_affiliate_settlement_venda_per_order
  on public.affiliate_settlement_transactions (order_id)
  where type = 'venda' and order_id is not null;

-- Chamada pelo servidor depois de confirmar o estorno de verdade (Pix/
-- cartão) — lança o 'estorno' na parceria (se essa venda tinha comissão
-- lançada) e desfaz o cashback/bônus do pedido. Idempotente.
create or replace function public.reverse_order_settlement(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_venda record;
begin
  select id, partnership_id, amount into v_venda
    from public.affiliate_settlement_transactions
    where order_id = p_order_id and type = 'venda'
    limit 1;

  if found and not exists (
    select 1 from public.affiliate_settlement_transactions
    where order_id = p_order_id and type = 'estorno'
  ) then
    insert into public.affiliate_settlement_transactions (partnership_id, type, amount, order_id, note)
    values (v_venda.partnership_id, 'estorno', v_venda.amount, p_order_id, 'Pedido reembolsado');
  end if;

  perform public.reverse_order_cashback(p_order_id);
end;
$$;

revoke execute on function public.reverse_order_settlement(uuid) from public, anon, authenticated;
