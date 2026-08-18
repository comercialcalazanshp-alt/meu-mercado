-- Meu Mercado — v83.
-- A cota mensal de geração de imagem por IA e os pacotes extras já
-- existiam como tabelas (affiliate_ai_packages, affiliate_ai_purchases,
-- affiliate_ai_image_events), mas nada no backend de verdade contava uso
-- nem bloqueava — qualquer loja gerava imagens ilimitadas de graça.
-- extra_credits_remaining é um saldo simples de créditos comprados (pacote
-- extra) que só é consumido depois que a cota mensal grátis acaba —
-- evita ter que recalcular histórico de uso todo mês pra saber quanto
-- ainda sobra de pacote comprado.
alter table public.affiliate_partnerships
  add column if not exists extra_credits_remaining numeric not null default 0;
