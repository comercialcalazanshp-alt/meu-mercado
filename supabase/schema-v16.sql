-- Meu Mercado — v16.
-- Horário de funcionamento: opcional (loja com tudo em branco continua
-- sempre "aberta", igual hoje). Quando configurado, a vitrine avisa quando
-- está fechada em vez de deixar pedido entrar sem ninguém pra ver.

alter table stores add column if not exists business_hours_enabled boolean not null default false;
alter table stores add column if not exists opens_at time;
alter table stores add column if not exists closes_at time;
alter table stores add column if not exists open_days integer[] not null default '{0,1,2,3,4,5,6}';
alter table stores add column if not exists manually_closed boolean not null default false;
