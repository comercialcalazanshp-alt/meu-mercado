-- Meu Mercado — v26.
-- Crediário: mesma base do Fiado (credit_customers/credit_transactions),
-- mas agora a venda pode ter vencimento — e se passar da data, acumula
-- juros mensal (proporcional aos dias de atraso) sobre o valor daquela
-- venda. Sem vencimento, continua se comportando como fiado simples de
-- sempre (nada muda pra quem não usar). O juro nunca é somado ao saldo
-- guardado — é calculado na hora de exibir, igual o Comercial Calazans.

alter table credit_transactions add column if not exists due_date date;
alter table stores add column if not exists credit_interest_percent numeric not null default 0;
