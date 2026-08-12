-- Meu Mercado — v36.
-- Pagamento Pix via PagBank no checkout do site: cliente escolhe "Pix" e
-- vê na hora o QR code + código copia-e-cola pra pagar. Quando o PagBank
-- confirma o pagamento (aviso automático — webhook), o pedido é marcado
-- como pago sozinho, sem o dono precisar checar nada na mão.

alter table orders add column if not exists pix_qr_code_text text;
alter table orders add column if not exists pix_qr_code_image text;
alter table orders add column if not exists pagbank_order_id text;
alter table orders add column if not exists pix_paid_at timestamptz;
