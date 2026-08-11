-- Meu Mercado — v32.
-- Acesso só-leitura pro contador: em vez de dar a senha da loja pro
-- contador, o dono compartilha um link secreto (com um token aleatório) que
-- abre um resumo financeiro read-only — sem login, sem conseguir editar
-- nada. Se o link vazar, o dono gera um novo na hora e o antigo para de
-- funcionar.

alter table stores add column if not exists accountant_token uuid not null default gen_random_uuid();
