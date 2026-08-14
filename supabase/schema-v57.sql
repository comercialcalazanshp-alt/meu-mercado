-- Meu Mercado — v57.
-- Bug: depois de raspar, se o cliente atualizasse a página a raspadinha
-- aparecia disponível de novo — o resultado só ficava guardado em memória
-- no navegador (useState), então um reload sempre começava do zero. O
-- cliente não conseguia criar um segundo card de verdade (a raspadinha em
-- si respeitava o limite de 1 por semana), mas a tela mentia mostrando o
-- botão "Raspar" outra vez.
--
-- Fix: nova função só-leitura que devolve o card da semana atual pro
-- cliente logado, SE já existir — sem criar um novo (diferente de
-- get_or_create_scratch_card, que cria). O site chama essa função ao
-- carregar a página pra restaurar o estado certo antes do cliente clicar
-- em qualquer coisa.
create or replace function public.get_my_scratch_card(p_store_id uuid)
returns table (discount_percent numeric, redeemed boolean, already_existed boolean, expired boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_week date := date_trunc('week', now())::date;
  v_existing record;
begin
  if v_auth_uid is null then
    return;
  end if;

  select * into v_existing from public.scratch_cards
    where store_id = p_store_id and profile_id = v_auth_uid and week_start = v_week;

  if not found then
    return;
  end if;

  return query select
    v_existing.discount_percent,
    v_existing.redeemed,
    true,
    (now() - v_existing.created_at > interval '48 hours');
end;
$$;
