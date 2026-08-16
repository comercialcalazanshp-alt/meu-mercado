-- Meu Mercado — v74.
-- Cadastro completo do cargo "entregador": em vez de só um convite por
-- e-mail (que a pessoa precisa auto-completar em /cadastro), o dono
-- preenche nome/telefone/nascimento, o entregador aceita um termo de
-- condições de trabalho (digitando "SIM" numa página pública), e só
-- depois disso o dono gera um login e senha pra repassar pra ele — sem
-- precisar do e-mail de verdade da pessoa (usamos um e-mail interno
-- derivado do telefone só pra satisfazer o Supabase Auth, que exige um
-- e-mail como identificador).

alter table public.store_members add column if not exists full_name text;
alter table public.store_members add column if not exists phone text;
alter table public.store_members add column if not exists birth_date date;
alter table public.store_members add column if not exists terms_accepted_at timestamptz;
alter table public.store_members add column if not exists value_per_delivery numeric check (value_per_delivery is null or value_per_delivery >= 0);

-- Nenhuma policy nova aqui de propósito pra essas colunas: a leitura/escrita
-- anônima (antes do aceite, e a criação da conta depois dele) passa sempre
-- pelas rotas de API com a service role key, nunca direto do navegador —
-- RLS continua exigindo dono de verdade (auth.uid() = stores.owner_id),
-- igual já era.

-- O membro precisa conseguir ler a própria linha (nome, telefone, valor por
-- entrega) — a policy existente só libera pro DONO de verdade, de propósito
-- (pra ninguém se auto-promover), então isso aqui soma uma policy só de
-- leitura da própria linha, sem abrir escrita nenhuma pra ninguém além do
-- dono.
drop policy if exists "membro ve a propria linha" on public.store_members;
create policy "membro ve a propria linha" on public.store_members for select
  using (lower(email) = lower(coalesce(auth.email(), '')));

-- ============================================================
-- Quanto o entregador tem a receber
-- ============================================================
-- "delivered_by" registra QUAL membro da equipe marcou a entrega como
-- concluída (só preenchido quando é de fato um cargo "entregador" —
-- fica null se foi o próprio dono quem marcou). "delivery_payout_settled"
-- é o dono confirmando que já pagou aquela entrega — sem isso o "a
-- receber" do entregador cresceria pra sempre, sem nunca zerar.
alter table public.orders add column if not exists delivered_by uuid references public.store_members(id) on delete set null;
alter table public.orders add column if not exists delivery_payout_settled boolean not null default false;

create index if not exists idx_orders_delivered_by on public.orders (delivered_by) where delivered_by is not null;

-- Preenche "delivered_by" sozinho quando o status vira "entregue" — nunca
-- deixa o cliente da API escolher esse valor na mão (evita alguém marcar
-- entrega de outra pessoa como sua). Também trava "delivery_payout_settled"
-- pra quem não é o dono de verdade da loja — só o dono pode confirmar que
-- pagou, o entregador não pode se auto-declarar pago.
create or replace function public.guard_order_delivery_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_is_owner boolean;
  v_my_member_id uuid;
begin
  select (owner_id = auth.uid()) into v_caller_is_owner from public.stores where id = new.store_id;

  if coalesce(v_caller_is_owner, false) then
    return new;
  end if;

  new.delivery_payout_settled := old.delivery_payout_settled;

  if new.status = 'entregue' and old.status is distinct from 'entregue' then
    select sm.id into v_my_member_id
    from public.store_members sm
    where sm.store_id = new.store_id
      and sm.role = 'entregador'
      and lower(sm.email) = lower(coalesce(auth.email(), ''))
    limit 1;
    new.delivered_by := v_my_member_id;
  else
    new.delivered_by := old.delivered_by;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_order_delivery_fields_trigger on public.orders;
create trigger guard_order_delivery_fields_trigger
  before update on public.orders
  for each row execute function public.guard_order_delivery_fields();
