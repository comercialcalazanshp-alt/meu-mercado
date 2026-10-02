-- Meu Mercado — v147.
-- Ordem dos botões na faixa de venda rápida (Pães) do PDV. Sem isso a ordem
-- dependeria da data de criação do produto, que não dá pra controlar.
alter table public.products add column if not exists quick_sale_order integer not null default 0;

-- PostgREST guarda um cache das colunas; força ele a enxergar as novas
-- (quick_sale da v146 e quick_sale_order daqui) sem esperar.
notify pgrst, 'reload schema';
