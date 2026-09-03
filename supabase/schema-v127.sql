-- Meu Mercado — v127.
-- Nova opção por loja: esconder da vitrine produto sem estoque, em vez de
-- mostrar "esgotado" com o botão desativado. Fica desligada por padrão
-- (comportamento de sempre continua igual pra quem não mexer) — cada loja
-- liga em Configurações se quiser.
alter table public.stores add column if not exists hide_out_of_stock boolean not null default false;
