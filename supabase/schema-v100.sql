-- Meu Mercado — v100.
-- Achado testando o pedido mínimo (v99): quando "create or replace
-- function" ganha um parâmetro novo (p_payment_method, na v92), o
-- Postgres não substitui a função antiga — cria uma segunda versão
-- (overload) e deixa as duas no banco. Isso não quebrava nada até agora
-- porque todo lugar que chama checkout()/checkout_hub() sempre manda
-- p_payment_method — mas qualquer chamada nova que omitisse esse
-- parâmetro ia falhar com "Could not choose the best candidate function".
-- Remove as versões antigas (sem p_payment_method) de vez.
drop function if exists public.checkout(uuid, text, text, jsonb, text, text, boolean, date, uuid, text, uuid);
drop function if exists public.checkout_hub(uuid, text, text, jsonb, boolean, date, text);
