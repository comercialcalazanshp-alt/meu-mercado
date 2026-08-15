-- Meu Mercado — v71.
-- Modelo de dados de plano/assinatura da plataforma (Meu Mercado cobrando
-- a LOJA pra usar a plataforma — diferente do módulo "Assinaturas" que já
-- existe, que é a loja vendendo cesta recorrente pro cliente final dela).
-- Só o modelo de dados por enquanto: catálogo de planos + qual plano cada
-- loja está, pra dar base pro que vem depois (cobrança de verdade via
-- PagBank, página de planos pro dono escolher). limites e preços abaixo
-- são ponto de partida, ajustáveis depois direto na tabela ou por uma
-- tela de admin.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price_monthly numeric not null default 0,
  max_products numeric,
  max_team_members numeric,
  created_at timestamptz not null default now()
);

alter table public.plans enable row level security;

drop policy if exists "planos sao publicos" on public.plans;
create policy "planos sao publicos" on public.plans for select
  using (true);

insert into public.plans (code, name, price_monthly, max_products, max_team_members)
values
  ('gratis', 'Grátis', 0, 30, 1),
  ('basico', 'Básico', 49.9, 300, 3),
  ('pro', 'Pro', 99.9, null, null)
on conflict (code) do nothing;

alter table public.stores
  add column if not exists plan_id uuid references public.plans(id);

alter table public.stores
  add column if not exists plan_renews_at timestamptz;

update public.stores
  set plan_id = (select id from public.plans where code = 'gratis' limit 1)
  where plan_id is null;

-- Postgres não deixa usar subconsulta em DEFAULT de coluna — um gatilho
-- resolve a mesma coisa pra loja nova (o cadastro em si continua sem saber
-- de plano, só ganha o "Grátis" automaticamente ao ser criada).
create or replace function public.set_default_store_plan()
returns trigger
language plpgsql
as $$
begin
  if new.plan_id is null then
    select id into new.plan_id from public.plans where code = 'gratis' limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists set_default_store_plan_trigger on public.stores;
create trigger set_default_store_plan_trigger
  before insert on public.stores
  for each row execute function public.set_default_store_plan();
