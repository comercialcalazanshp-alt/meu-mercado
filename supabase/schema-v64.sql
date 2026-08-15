-- Meu Mercado — v64.
-- O juro por atraso no fiado só era uma conta de cabeça mostrada na tela —
-- nunca virava saldo de verdade, o dono tinha que somar principal+juros e
-- digitar o total na hora de registrar o pagamento. Adiciona um tipo de
-- transação "juros" (mesmo efeito de "venda": aumenta o saldo devedor) pra
-- ter um botão "Aplicar juros" que lança isso de verdade, com registro no
-- extrato.
alter table public.credit_transactions
  drop constraint if exists credit_transactions_type_check;
alter table public.credit_transactions
  add constraint credit_transactions_type_check check (type in ('venda', 'pagamento', 'juros'));

create or replace function public.apply_credit_transaction()
returns trigger
language plpgsql
as $$
begin
  if new.type in ('venda', 'juros') then
    update credit_customers set balance = balance + new.amount where id = new.customer_id;
  else
    update credit_customers set balance = balance - new.amount where id = new.customer_id;
  end if;
  return new;
end;
$$;
