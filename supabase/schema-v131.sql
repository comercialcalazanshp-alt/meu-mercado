-- Painel de "quanto posso tirar" no Dashboard: o dono configura 3 % (capital
-- de giro / pró-labore / investimento) e o sistema calcula os valores reais
-- em cima do lucro líquido do período JÁ recebido em dinheiro (sem contar
-- fiado, que ainda não virou caixa). Fica desligado por padrão — só aparece
-- pra quem configurar de propósito.
alter table public.stores add column if not exists finance_split_enabled boolean not null default false;
alter table public.stores add column if not exists finance_split_giro_percent numeric not null default 50;
alter table public.stores add column if not exists finance_split_prolabore_percent numeric not null default 30;
alter table public.stores add column if not exists finance_split_investimento_percent numeric not null default 20;
