-- Meu Mercado — v117.
-- Corrige affiliate_assistant_enabled (v116): o fallback considerava
-- "sem parceria ATIVA" como "não é afiliado, libera geral" — então se um
-- dia uma parceria for desativada (encerrada), esse afiliado voltaria a
-- ter acesso livre e grátis ao assistente, o oposto do esperado. Agora o
-- fallback olha se existe QUALQUER parceria (ativa ou não) pra aquela
-- loja: só libera geral quando ela nunca foi módulo de afiliado.
create or replace function public.affiliate_assistant_enabled(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (
      select true
      from public.affiliate_partnerships p
      join public.affiliate_extras e on e.hub_store_id = p.hub_store_id and e.code = 'assistente_ia'
      join public.affiliate_partnership_extras pe on pe.partnership_id = p.id and pe.extra_id = e.id
      where p.module_store_id = p_store_id and p.active and pe.enabled
      limit 1
    ),
    not exists (
      select 1 from public.affiliate_partnerships p2 where p2.module_store_id = p_store_id
    )
  );
$$;
