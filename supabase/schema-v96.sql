-- Meu Mercado — v96.
-- Boleto como segunda forma de pagamento do afiliado (mensalidade e
-- pacote extra de IA), além do Pix (v87/v91-v95). Diferente do Pix, o
-- boleto tem código de barras e um link de PDF pra guardar — pagbank_order_id
-- (reaproveitado como id da cobrança na Efí) já existia, só faltam esses
-- dois campos novos.
alter table public.affiliate_subscription_payments add column if not exists boleto_barcode text;
alter table public.affiliate_subscription_payments add column if not exists boleto_pdf_url text;
alter table public.affiliate_subscription_payments add column if not exists boleto_expire_at date;

alter table public.affiliate_ai_purchases add column if not exists boleto_barcode text;
alter table public.affiliate_ai_purchases add column if not exists boleto_pdf_url text;
alter table public.affiliate_ai_purchases add column if not exists boleto_expire_at date;

-- Estorno de Pix: pra devolver, a Efí exige o endToEndId da transação
-- original — não existia em lugar nenhum, só o txid da cobrança. Guarda
-- isso quando o webhook confirma o pagamento, e o momento em que foi
-- devolvido (evita devolver duas vezes o mesmo pedido).
alter table public.orders add column if not exists pix_end_to_end_id text;
alter table public.orders add column if not exists pix_refunded_at timestamptz;
alter table public.hub_orders add column if not exists pix_end_to_end_id text;
