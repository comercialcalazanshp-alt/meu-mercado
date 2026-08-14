-- Meu Mercado — v51.
-- Módulo "Clientes" unificado no painel: o dono pedia pra tirar o botão de
-- resetar acesso de dentro de Cashback (não fazia sentido lá) e juntar num
-- lugar só tudo relacionado a cliente — conta/bloqueio, fiado e histórico de
-- pedidos com reimpressão de cupom.
--
-- Precisa de uma função nova porque customer_profiles só pode ser lida pelo
-- próprio cliente (RLS "id = auth.uid()") — o dono da loja não teria como
-- saber se um cliente tem conta / está bloqueado sem isso, sem violar a
-- privacidade dos outros campos (CPF, nome completo) que o dono não precisa
-- ver pra essa finalidade.

create or replace function public.customer_account_status(p_store_id uuid, p_phone text)
returns table (has_account boolean, locked boolean, email_masked text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_email text;
  v_locked boolean;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  select profile_id into v_profile_id from customers
    where store_id = p_store_id and phone = trim(p_phone);

  if v_profile_id is null then
    return query select false, false, null::text;
    return;
  end if;

  select email into v_email from customer_profiles where id = v_profile_id;
  select cla.locked into v_locked from customer_login_attempts cla where cla.email = lower(v_email);

  return query select
    true,
    coalesce(v_locked, false),
    case
      when v_email is not null then left(v_email, 2) || '***@' || split_part(v_email, '@', 2)
      else null
    end;
end;
$$;

grant execute on function public.customer_account_status(uuid, text) to authenticated;
