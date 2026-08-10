-- Meu Mercado — v2.
-- Corrige o cadastro: com confirmação de e-mail obrigatória, o navegador não
-- tem mais uma sessão autenticada logo após signUp() (só depois que a pessoa
-- clica no link do e-mail). Então criar a loja direto do navegador batia na
-- política de segurança (RLS) da tabela stores.
--
-- Solução padrão do Supabase: um gatilho no auth.users que cria a loja
-- automaticamente, rodando com privilégio de dono da tabela (ignora RLS),
-- usando os dados que o formulário manda dentro de options.data no signUp().

create or replace function public.handle_new_store_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text := coalesce(nullif(new.raw_user_meta_data->>'store_slug', ''), 'loja');
  final_slug text := base_slug;
  attempt int := 0;
begin
  loop
    begin
      insert into public.stores (owner_id, slug, name, whatsapp)
      values (
        new.id,
        final_slug,
        coalesce(new.raw_user_meta_data->>'store_name', 'Minha loja'),
        nullif(new.raw_user_meta_data->>'whatsapp', '')
      );
      exit;
    exception when unique_violation then
      attempt := attempt + 1;
      final_slug := base_slug || '-' || floor(random() * 10000)::int;
      if attempt > 5 then
        raise;
      end if;
    end;
  end loop;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_store_owner();

-- Se a conta do dono for excluída, a loja dele (e produtos/pedidos, que já
-- têm cascade a partir de stores) some junto — evita registro órfão preso.
alter table public.stores drop constraint if exists stores_owner_id_fkey;
alter table public.stores
  add constraint stores_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete cascade;
