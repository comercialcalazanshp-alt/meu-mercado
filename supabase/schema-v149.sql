-- Meu Mercado — v149.
-- Editar o cadastro de um cliente do crediário (nome e WhatsApp).
--
-- O WhatsApp é a "chave" do cliente: o histórico de pedidos (orders.customer_phone),
-- a nota interna e o bloqueio (customer_notes.phone) são ligados a ele por esse
-- número. Trocar só credit_customers.phone faria o histórico e o bloqueio dele
-- "sumirem" da tela. Esta função troca tudo junto, numa operação só.
--
-- Regras:
--  - só quem tem acesso completo à loja (my_store_ids);
--  - nome e WhatsApp obrigatórios; WhatsApp não pode já ser de outro cliente;
--  - se o cliente tem conta no site com o número antigo, o número não muda aqui
--    (a conta do site é de outra tabela e ficaria separada do crediário);
--  - pedidos de contas do site (customer_id preenchido) não são mexidos.

create or replace function public.update_credit_customer(
  p_customer_id uuid,
  p_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cc record;
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := trim(coalesce(p_phone, ''));
begin
  select * into v_cc
  from public.credit_customers
  where id = p_customer_id and store_id in (select public.my_store_ids());
  if not found then
    raise exception 'Cliente não encontrado';
  end if;

  if v_name = '' then
    raise exception 'Digite o nome do cliente.';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Nome muito grande (máximo 80 letras).';
  end if;
  if v_phone = '' then
    raise exception 'Digite o WhatsApp do cliente.';
  end if;
  if char_length(v_phone) > 60 then
    raise exception 'WhatsApp inválido.';
  end if;

  if v_phone <> v_cc.phone then
    if exists (
      select 1 from public.credit_customers
      where store_id = v_cc.store_id and phone = v_phone and id <> v_cc.id
    ) then
      raise exception 'Já existe outro cliente com esse WhatsApp.';
    end if;

    if exists (
      select 1 from public.customers
      where store_id = v_cc.store_id and phone = v_cc.phone
    ) then
      raise exception 'Esse cliente tem conta no site com esse número, então o WhatsApp não pode ser trocado por aqui.';
    end if;

    update public.credit_customers set phone = v_phone where id = v_cc.id;

    -- nota interna / bloqueio acompanham o número (se já houver sobra de nota no
    -- número novo, a do cliente ganha)
    delete from public.customer_notes where store_id = v_cc.store_id and phone = v_phone;
    update public.customer_notes set phone = v_phone
    where store_id = v_cc.store_id and phone = v_cc.phone;

    -- histórico de pedidos de balcão desse número
    update public.orders set customer_phone = v_phone
    where store_id = v_cc.store_id and customer_phone = v_cc.phone and customer_id is null;
  end if;

  update public.credit_customers set name = v_name where id = v_cc.id;
  update public.orders set customer_name = v_name
  where store_id = v_cc.store_id and customer_phone = v_phone and customer_id is null;
end;
$$;

revoke all on function public.update_credit_customer(uuid, text, text) from public, anon;
grant execute on function public.update_credit_customer(uuid, text, text) to authenticated;
