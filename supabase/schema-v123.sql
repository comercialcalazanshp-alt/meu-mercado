-- Meu Mercado — v123.
-- Duas policies de RLS liberavam mais do que o app realmente usa:
--
-- 1) "lista compartilhada e publica" (select using (true)) em
--    shared_lists deixava qualquer um listar TODAS as listas de compra
--    compartilhadas de TODAS as lojas — o app só busca por id (vindo do
--    link), nunca lista em massa. Troca a policy por uma RPC que só
--    devolve a lista quando você já sabe o id (o link continua
--    funcionando igual), e fecha o select direto na tabela.
--
-- 2) "qualquer um atualiza a propria sessao" (update using (true)) em
--    site_visits deixava qualquer um alterar o registro de visita de
--    QUALQUER sessão de QUALQUER loja (ex: forjar conversão, zerar
--    page_views). O app nunca faz update direto nessa tabela — sempre usa
--    a função track_site_visit() (security definer), que já teria acesso
--    de qualquer forma. A policy nunca foi necessária; remove.
drop policy if exists "lista compartilhada e publica" on public.shared_lists;
drop policy if exists "qualquer um atualiza a propria sessao" on public.site_visits;

create or replace function public.get_shared_list(p_id uuid, p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select items from public.shared_lists where id = p_id and store_id = p_store_id;
$$;

grant execute on function public.get_shared_list(uuid, uuid) to anon, authenticated;
