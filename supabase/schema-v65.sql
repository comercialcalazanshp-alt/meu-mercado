-- Meu Mercado — v65.
-- Dois gaps do fiado, achados na auditoria:
--
-- 1) Nenhum limite de crédito por cliente — um cliente fiado podia acumular
--    dívida sem fim. credit_limit é opcional (null = sem limite, igual
--    hoje); quando definido, uma nova venda que estouraria o limite é
--    barrada dentro do próprio gatilho que já mantém o saldo — isso cobre
--    tanto a tela de Fiado quanto uma venda fiado feita no PDV, sem
--    precisar duplicar a checagem nos dois lugares.
--
-- 2) Não existia jeito honesto de zerar uma dívida que nunca vai ser paga —
--    a única forma era fingir um "pagamento" que nunca aconteceu, o que
--    mistura dívida perdoada com dinheiro recebido de verdade no extrato.
--    Novo tipo "baixa" tem o mesmo efeito no saldo de um pagamento (reduz),
--    mas fica registrado separado pra não mentir no histórico.

alter table public.credit_customers
  add column if not exists credit_limit numeric check (credit_limit is null or credit_limit >= 0);

alter table public.credit_transactions
  drop constraint if exists credit_transactions_type_check;
alter table public.credit_transactions
  add constraint credit_transactions_type_check check (type in ('venda', 'pagamento', 'juros', 'baixa'));

create or replace function public.apply_credit_transaction()
returns trigger
language plpgsql
as $$
declare
  v_limit numeric;
  v_balance numeric;
begin
  if new.type in ('venda', 'juros') then
    if new.type = 'venda' then
      select credit_limit, balance into v_limit, v_balance
        from credit_customers where id = new.customer_id;
      if v_limit is not null and v_balance + new.amount > v_limit then
        raise exception 'Essa venda passaria do limite de crédito do cliente (limite: %, saldo atual: %)', v_limit, v_balance;
      end if;
    end if;
    update credit_customers set balance = balance + new.amount where id = new.customer_id;
  else
    update credit_customers set balance = balance - new.amount where id = new.customer_id;
  end if;
  return new;
end;
$$;
