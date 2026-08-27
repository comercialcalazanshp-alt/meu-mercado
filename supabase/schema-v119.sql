-- Meu Mercado — v119.
-- CORREÇÃO DE SEGURANÇA/DINHEIRO: cobrança de cartão (charge-card) checava
-- "já foi pago?" e só marcava como pago DEPOIS de cobrar no PagBank — duas
-- requisições quase simultâneas pro mesmo pedido (duplo clique, retry de
-- rede) passavam as duas pela checagem antes de qualquer uma marcar o
-- pedido, e as duas cobravam o cartão de verdade. Isso também abre porta
-- pra testar números de cartão roubado em massa contra o mesmo pedido.
--
-- Corrige com uma "reserva" atômica: antes de chamar o PagBank, tenta
-- marcar o pedido como "cobrando agora" (só um pedido consegue por vez,
-- por causa do "where" na hora do update). Se a cobrança falhar, libera a
-- reserva pra permitir tentar de novo (ex: cartão recusado, tenta outro).
-- A reserva expira sozinha depois de 30s (trava de segurança caso o
-- servidor caia no meio da chamada ao PagBank).
alter table public.orders add column if not exists card_charging_at timestamptz;
alter table public.hub_orders add column if not exists card_charging_at timestamptz;

create or replace function public.claim_card_charge(p_order_id uuid, p_is_hub boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated int;
begin
  if p_is_hub then
    update public.hub_orders
      set card_charging_at = now()
      where id = p_order_id
        and card_paid_at is null
        and (card_charging_at is null or card_charging_at < now() - interval '30 seconds');
  else
    update public.orders
      set card_charging_at = now()
      where id = p_order_id
        and card_paid_at is null
        and (card_charging_at is null or card_charging_at < now() - interval '30 seconds');
  end if;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Assim como credit_pending_cashback, só o servidor pode chamar — não
-- valida quem está pedindo, confia que quem chama já verificou o resto.
revoke execute on function public.claim_card_charge(uuid, boolean) from public, anon, authenticated;
