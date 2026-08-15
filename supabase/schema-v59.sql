-- Meu Mercado — v59.
-- Achado na auditoria: o botão "Desativar" do super-admin (src/app/admin)
-- só derrubava a vitrine pública da loja — o dono (e qualquer membro da
-- equipe) continuava com acesso total ao painel: PDV, produtos, pedidos,
-- fiado, caixa, configurações, tudo. Ou seja, o único mecanismo de
-- suspensão que a plataforma tem hoje não suspendia nada de verdade no
-- backend, só escondia a loja dos clientes.
--
-- my_store_ids() é a função central que quase toda política de RLS usa pra
-- decidir "essa linha pertence a uma loja desse usuário?" — adicionando o
-- filtro active=true aqui, o efeito se propaga automaticamente pra todo
-- lugar que já confia nela, sem precisar mexer em cada política uma por
-- uma.
create or replace function public.my_store_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from stores where owner_id = auth.uid() and active = true
  union
  select sm.store_id from store_members sm
    join stores s on s.id = sm.store_id
  where lower(sm.email) = lower(coalesce(auth.email(), '')) and s.active = true
$$;
