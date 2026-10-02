-- Meu Mercado — v146.
-- Tela "PDV Pães" (venda rápida, só toque nos botões): quais produtos
-- aparecem lá é uma marcação no próprio produto (quick_sale), em vez de
-- depender de nome ou categoria — assim dá pra pôr outros itens de giro
-- rápido na mesma tela depois (café, bolo...) sem mexer em código.
alter table public.products add column if not exists quick_sale boolean not null default false;
