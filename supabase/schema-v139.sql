-- Logo da loja — mostrada na barra lateral do painel e no topo do PDV.
-- get_my_store() já faz "select s.*", então flui automático sem tocar na
-- função.
alter table public.stores add column if not exists logo_url text;
