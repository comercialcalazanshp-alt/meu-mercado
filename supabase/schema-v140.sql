-- Trava de 4 dígitos pra abrir Configurações — o DONO nunca fica trancado
-- fora (a checagem é sempre pulada pra quem é owner_id da loja); serve pra
-- alguém com "Acesso completo" (ex: quem cobre a loja numa ausência) usar
-- PDV/Pedidos/etc normalmente mas precisar do PIN pra mexer nas
-- configurações da loja. Null = trava desligada (comportamento de hoje).
alter table public.stores add column if not exists settings_pin text;
