-- Meu Mercado — v15.
-- Aviso em tempo real de pedido novo no painel: liga o Supabase Realtime
-- pra tabela orders. O RLS que já existe ("dono ve pedidos da propria
-- loja") continua valendo pro Realtime — cada dono só recebe eventos dos
-- próprios pedidos, não precisa de policy nova nenhuma.

alter publication supabase_realtime add table orders;
