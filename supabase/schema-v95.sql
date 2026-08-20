-- Meu Mercado — v95.
-- Cliente com conta (customer_profiles) tinha que redigitar nome, telefone
-- e endereço em TODO pedido, mesmo já logado — nada ficava salvo. Adiciona
-- telefone e endereço padrão no perfil (cross-loja, ligado ao login), pra
-- pré-preencher o checkout — o campo continua editável, então o cliente
-- ainda pode trocar só pra aquele pedido específico sem afetar o padrão
-- salvo (o padrão só atualiza de novo se ele usar outro endereço e
-- finalizar a compra normalmente).
alter table public.customer_profiles add column if not exists phone text;
alter table public.customer_profiles add column if not exists default_address text;
