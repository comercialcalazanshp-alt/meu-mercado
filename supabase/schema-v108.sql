-- Meu Mercado — v108.
-- Cliente só podia desistir do pedido reclamando depois de entregue —
-- não tinha como cancelar um pedido que ainda nem saiu (mudou de ideia,
-- clicou errado). Mesma confiança de file_complaint (schema-v79): saber
-- o id do pedido (da URL do recibo) já basta, sem exigir login.
create or replace function public.customer_cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  select status into v_status from public.orders where id = p_order_id;

  if v_status is null then
    raise exception 'Pedido não encontrado';
  end if;

  if v_status not in ('pendente', 'confirmado') then
    raise exception 'Esse pedido já está sendo preparado ou entregue — fale direto com a loja pra cancelar.';
  end if;

  update public.orders set status = 'cancelado', cancel_reason = 'Cancelado pelo cliente' where id = p_order_id;
end;
$$;

grant execute on function public.customer_cancel_order(uuid) to anon, authenticated;
