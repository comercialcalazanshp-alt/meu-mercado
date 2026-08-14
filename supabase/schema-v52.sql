-- Meu Mercado — v52.
-- Banner: ponto focal + texto sobreposto. Até aqui a imagem do banner caía
-- crua numa caixa larga (~2:1) com corte automático (object-cover) — sem
-- controle nenhum, o que cortava qualquer texto desenhado perto da borda da
-- imagem. Agora o texto vira uma camada separada (nunca é cortado, dá pra
-- editar sem gerar imagem de novo) e a foto ganha um "ponto focal" — o dono
-- clica no que não pode sumir, e o corte automático da tela sempre respeita
-- esse ponto, em qualquer tamanho de tela.

alter table banners add column if not exists focal_x numeric not null default 0.5;
alter table banners add column if not exists focal_y numeric not null default 0.5;
alter table banners add column if not exists text_style text;
alter table banners add column if not exists overlay_text text;

alter table banners drop constraint if exists banners_focal_x_check;
alter table banners add constraint banners_focal_x_check check (focal_x >= 0 and focal_x <= 1);

alter table banners drop constraint if exists banners_focal_y_check;
alter table banners add constraint banners_focal_y_check check (focal_y >= 0 and focal_y <= 1);

alter table banners drop constraint if exists banners_text_style_check;
alter table banners add constraint banners_text_style_check
  check (text_style is null or text_style in ('faixa-inferior', 'selo-canto', 'faixa-lateral'));
