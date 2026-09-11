-- Guarda a forma de pagamento usada quando o cliente paga (baixa) uma dívida
-- de crediário — hoje o pagamento era registrado sem essa informação, então
-- não dava pra saber se o dono recebeu em dinheiro, pix ou cartão, nem
-- imprimir um comprovante correto pro cliente.
alter table public.credit_transactions add column if not exists payment_method text;

alter table public.credit_transactions
  drop constraint if exists credit_transactions_payment_method_check;
alter table public.credit_transactions
  add constraint credit_transactions_payment_method_check
  check (payment_method is null or payment_method in ('dinheiro', 'pix', 'cartao'));
