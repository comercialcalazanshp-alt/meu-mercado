-- Meu Mercado — v48.
-- Segunda cor da loja: brand_color continua sendo a identidade (cabeçalho),
-- accent_color é usada nos botões de ação (adicionar, finalizar pedido) pra
-- dar contraste e destacar quem converte de quem só decora.

alter table public.stores add column if not exists accent_color text not null default '#f59e0b';
