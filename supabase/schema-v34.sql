-- Meu Mercado — v34.
-- Personalização visual: o dono escolhe uma cor pra representar a loja no
-- site (cabeçalho, botões principais). O texto em cima da cor é calculado
-- automaticamente (preto ou dourado) pra sempre ficar legível, seja qual for
-- a cor escolhida.

alter table stores add column if not exists brand_color text not null default '#1e3a8a';
