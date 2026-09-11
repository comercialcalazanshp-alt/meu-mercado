-- 4ª divisão no painel "quanto eu posso tirar": impostos. Dinheiro que sai
-- obrigatório numa data certa (DAS do Simples etc.) — misturado com capital
-- de giro, é fácil gastar sem perceber e faltar na hora de pagar. Default 0
-- pra não quebrar a soma de 100% de quem já configurou as 3 divisões antigas.
alter table public.stores add column if not exists finance_split_impostos_percent numeric not null default 0;
