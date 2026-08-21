-- Meu Mercado — v98.
-- Boleto (Efí Cobranças) precisa de dados estruturados do afiliado que
-- não existiam: e-mail, telefone e endereço em partes separadas (CEP,
-- rua, número, bairro, cidade, UF) — só tínhamos "address" como texto
-- livre. O próprio afiliado deve preencher isso (ele sabe seus dados
-- melhor que o dono do hub), mas a RLS de affiliate_partnerships só deixa
-- o dono do hub escrever — por isso uma RPC própria, restrita só a esses
-- campos, verificando que quem chama é dono da loja afiliada.
alter table public.affiliate_partnerships add column if not exists billing_email text;
alter table public.affiliate_partnerships add column if not exists billing_phone text;
alter table public.affiliate_partnerships add column if not exists billing_cep text;
alter table public.affiliate_partnerships add column if not exists billing_street text;
alter table public.affiliate_partnerships add column if not exists billing_number text;
alter table public.affiliate_partnerships add column if not exists billing_neighborhood text;
alter table public.affiliate_partnerships add column if not exists billing_city text;
alter table public.affiliate_partnerships add column if not exists billing_state text;
alter table public.affiliate_partnerships add column if not exists billing_complement text;

create or replace function public.update_affiliate_billing_info(
  p_partnership_id uuid,
  p_billing_email text,
  p_billing_phone text,
  p_billing_cep text,
  p_billing_street text,
  p_billing_number text,
  p_billing_neighborhood text,
  p_billing_city text,
  p_billing_state text,
  p_billing_complement text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1
    from public.affiliate_partnerships ap
    join public.stores s on s.id = ap.module_store_id
    where ap.id = p_partnership_id and s.owner_id = auth.uid()
  ) then
    raise exception 'Sem permissão pra editar essa parceria';
  end if;

  update public.affiliate_partnerships
  set
    billing_email = nullif(trim(p_billing_email), ''),
    billing_phone = nullif(trim(p_billing_phone), ''),
    billing_cep = nullif(trim(p_billing_cep), ''),
    billing_street = nullif(trim(p_billing_street), ''),
    billing_number = nullif(trim(p_billing_number), ''),
    billing_neighborhood = nullif(trim(p_billing_neighborhood), ''),
    billing_city = nullif(trim(p_billing_city), ''),
    billing_state = nullif(trim(p_billing_state), ''),
    billing_complement = nullif(trim(p_billing_complement), '')
  where id = p_partnership_id;
end;
$$;

grant execute on function public.update_affiliate_billing_info(uuid, text, text, text, text, text, text, text, text, text) to authenticated;
