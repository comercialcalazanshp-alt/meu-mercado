-- Meu Mercado — v128.
-- QR code Pix estático no PDV: em vez de pedir CPF do cliente e passar por
-- processador de pagamento (Efí), a loja cadastra até 2 chaves Pix próprias
-- e o PDV gera o QR code (padrão BR Code/EMV) na hora, com o valor exato da
-- venda, direto no navegador — sem chamada a nenhuma API externa. O caixa
-- confere o recebimento no próprio banco antes de finalizar (não há
-- confirmação automática, já que não passa por processador nenhum).
alter table public.stores add column if not exists pix_key_1 text;
alter table public.stores add column if not exists pix_key_1_label text;
alter table public.stores add column if not exists pix_key_2 text;
alter table public.stores add column if not exists pix_key_2_label text;
alter table public.stores add column if not exists pix_receiver_name text;
alter table public.stores add column if not exists pix_city text;
