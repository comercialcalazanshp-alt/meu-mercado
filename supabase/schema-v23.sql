-- Meu Mercado — v23.
-- Últimos campos que faltavam pra fechar paridade com o cadastro de
-- produto do Comercial Calazans: validade (perecíveis), fornecedor, e
-- upload de foto direto da galeria/câmera (bucket de storage público
-- pra leitura, mas só o dono da loja sobe/apaga arquivo da própria loja).

alter table products add column if not exists expiry_date date;
alter table products add column if not exists supplier text;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "fotos de produto sao publicas" on storage.objects;
create policy "fotos de produto sao publicas" on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "dono sobe foto na propria pasta" on storage.objects;
create policy "dono sobe foto na propria pasta" on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (select id::text from stores where owner_id = auth.uid())
  );

drop policy if exists "dono atualiza foto na propria pasta" on storage.objects;
create policy "dono atualiza foto na propria pasta" on storage.objects for update
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (select id::text from stores where owner_id = auth.uid())
  );

drop policy if exists "dono apaga foto na propria pasta" on storage.objects;
create policy "dono apaga foto na propria pasta" on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (select id::text from stores where owner_id = auth.uid())
  );
