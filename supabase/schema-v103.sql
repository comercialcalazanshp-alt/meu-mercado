-- Meu Mercado — v103.
-- Equipe (entregador/caixa) só podia ser removido de vez — pra afastar
-- alguém temporariamente (férias, suspensão) o dono tinha que deletar o
-- cadastro e o login, e recomeçar convite + termo + gerar login do zero
-- pra trazer de volta. Adiciona "active" em store_members (default true,
-- nada muda pra ninguém hoje) e faz as duas funções que toda política RLS
-- do painel já usa (my_store_ids/my_pdv_store_ids) passarem a exigir
-- active=true — um membro pausado perde acesso na hora, sem apagar nada.
alter table public.store_members add column if not exists active boolean not null default true;

create or replace function public.my_pdv_store_ids()
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
  where lower(sm.email) = lower(coalesce(auth.email(), '')) and s.active = true and sm.active = true
$$;

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
  where lower(sm.email) = lower(coalesce(auth.email(), ''))
    and sm.role = 'completo'
    and s.active = true
    and sm.active = true
$$;

create or replace function public.get_my_role(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when exists (select 1 from stores where id = p_store_id and owner_id = auth.uid()) then 'completo'
    else (
      select sm.role from store_members sm
        join stores s on s.id = sm.store_id
      where sm.store_id = p_store_id
        and lower(sm.email) = lower(coalesce(auth.email(), ''))
        and s.active = true
        and sm.active = true
      limit 1
    )
  end
$$;
