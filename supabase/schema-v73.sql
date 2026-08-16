-- Meu Mercado — v73.
-- Fundação do Hub de Afiliados: um afiliado não é um cadastro solto, é uma
-- loja de verdade dentro do sistema (mesmo painel, mesmo PDV que qualquer
-- outra loja) — essa migração cria a PARCERIA que liga a loja do hub à
-- loja do afiliado, mais tudo que depende dessa ligação: preços/extras
-- configuráveis, cota de imagem por IA com pacote pré-pago, extrato de
-- acerto (mesmo molde do fiado) e os pontos de retirada pro entregador em
-- pedido que envolve vários módulos.
--
-- Ainda não mexe no checkout do site nem cria a orquestração completa do
-- pedido multi-módulo — isso é o próximo passo, depois que essa fundação
-- estiver testada. Todas as instruções são idempotentes (seguro rodar de
-- novo), seguindo o mesmo padrão das migrações anteriores.

-- ============================================================
-- PARTE 0 — Endereço da loja
-- ============================================================

-- Nenhuma loja do sistema tem endereço estruturado hoje (nem a sua) — o
-- entregador precisa disso pra ter um ponto de retirada no seu próprio
-- módulo, então isso precisa existir em "stores", não só nos afiliados.
-- Nullable de propósito: não quebra nenhuma loja existente, só fica vazio
-- até você preencher (na sua, e no cadastro de cada afiliado).
alter table public.stores add column if not exists address text;
alter table public.stores add column if not exists lat numeric;
alter table public.stores add column if not exists lng numeric;

-- ============================================================
-- PARTE 1 — Tabelas
-- ============================================================

-- A parceria em si: liga a loja do hub (dono) à loja do afiliado (que já
-- existe como store própria, com painel/PDV/produtos dela) e guarda os
-- termos comerciais daquela ligação específica.
create table if not exists public.affiliate_partnerships (
  id uuid primary key default gen_random_uuid(),
  hub_store_id uuid references public.stores(id) on delete cascade not null,
  module_store_id uuid references public.stores(id) on delete cascade not null,
  category text not null,
  owner_name text not null,
  tax_id text not null,
  address text not null,
  lat numeric,
  lng numeric,
  license_number text,
  commission_percent numeric not null default 0
    check (commission_percent >= 0 and commission_percent <= 100),
  payout_method text not null default 'manual'
    check (payout_method in ('manual', 'split_automatico')),
  payout_speed text
    check (payout_speed is null or payout_speed in ('48h', '72h', 'semanal')),
  payout_pix_key text,
  payout_bank_details text,
  plan_type text not null default 'padrao'
    check (plan_type in ('padrao', 'personalizado')),
  billing_cycle text not null default 'mensal'
    check (billing_cycle in ('mensal', 'trimestral', 'semestral', 'anual')),
  subscription_price numeric,
  subscription_due_at timestamptz,
  ai_quota_monthly numeric,
  balance numeric not null default 0,
  contract_started_at date not null default current_date,
  contract_notice_days integer,
  contract_ends_at date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (hub_store_id <> module_store_id)
);

-- Categoria exclusiva só precisa ser única entre parcerias ATIVAS da mesma
-- loja — se uma parceria acabar, o nome da categoria pode ser reaproveitado
-- por um afiliado novo depois.
create unique index if not exists idx_affiliate_partnerships_hub_category_active
  on public.affiliate_partnerships (hub_store_id, category)
  where active;

create index if not exists idx_affiliate_partnerships_module_store
  on public.affiliate_partnerships (module_store_id);

-- Valores-base configuráveis na tela de Preços do hub — uma linha por loja
-- que tiver o módulo de afiliados ligado.
create table if not exists public.affiliate_settings (
  id uuid primary key default gen_random_uuid(),
  hub_store_id uuid references public.stores(id) on delete cascade not null unique,
  suggested_commission_percent numeric not null default 12
    check (suggested_commission_percent >= 0 and suggested_commission_percent <= 100),
  price_monthly numeric not null default 79.90,
  price_quarterly numeric not null default 227.70,
  price_semiannual numeric not null default 431.46,
  price_annual numeric not null default 815.00,
  anticipation_fee_48h_percent numeric not null default 4,
  anticipation_fee_72h_percent numeric not null default 2,
  upload_min_resolution_px integer not null default 1080,
  upload_aspect_ratio text not null default '1:1',
  upload_max_size_mb numeric not null default 8,
  ai_quota_monthly_default numeric not null default 5,
  created_at timestamptz not null default now()
);

-- Catálogo de extras pagos do hub (Destaque na home, Cupom próprio etc.) —
-- os preços são por loja, porque cada hub define os próprios valores.
create table if not exists public.affiliate_extras (
  id uuid primary key default gen_random_uuid(),
  hub_store_id uuid references public.stores(id) on delete cascade not null,
  code text not null,
  name text not null,
  price_monthly numeric not null default 0,
  included_in_padrao boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (hub_store_id, code)
);

-- Quais extras estão ligados em cada parceria.
create table if not exists public.affiliate_partnership_extras (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid references public.affiliate_partnerships(id) on delete cascade not null,
  extra_id uuid references public.affiliate_extras(id) on delete cascade not null,
  enabled boolean not null default false,
  price_override numeric,
  created_at timestamptz not null default now(),
  unique (partnership_id, extra_id)
);

-- Pacotes prontos de imagem por IA (+5/+20/+30) — preço por loja, igual
-- extras, visíveis pra qualquer afiliado do hub. "is_custom" marca um
-- pacote personalizado; quando "partnership_id" também está preenchido,
-- esse pacote é exclusivo daquela parceria específica (negociação do
-- Plano Personalizado) — quando "partnership_id" é nulo, é um pacote
-- personalizado genérico, visível pra todo mundo do hub.
create table if not exists public.affiliate_ai_packages (
  id uuid primary key default gen_random_uuid(),
  hub_store_id uuid references public.stores(id) on delete cascade not null,
  partnership_id uuid references public.affiliate_partnerships(id) on delete cascade,
  qty integer not null check (qty > 0),
  price numeric not null check (price >= 0),
  is_custom boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_affiliate_ai_packages_partnership
  on public.affiliate_ai_packages (partnership_id);

-- Cada imagem gerada ou editada por IA vira um registro aqui — é assim que
-- a cota do mês é contada (nunca um contador solto que pode dessincronizar).
create table if not exists public.affiliate_ai_image_events (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid references public.affiliate_partnerships(id) on delete cascade not null,
  kind text not null check (kind in ('gerada', 'editada')),
  created_at timestamptz not null default now()
);

create index if not exists idx_affiliate_ai_image_events_partnership
  on public.affiliate_ai_image_events (partnership_id, created_at);

-- Histórico de compra de pacote extra de imagem — pré-pago, confirmado
-- quando o Pix cai (paid_at preenchido). Quantidade e preço ficam
-- gravados aqui mesmo (não recalculados do catálogo depois), pra manter
-- o histórico fiel ao que foi cobrado na hora, mesmo que o preço do
-- catálogo mude depois.
create table if not exists public.affiliate_ai_purchases (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid references public.affiliate_partnerships(id) on delete cascade not null,
  package_id uuid references public.affiliate_ai_packages(id) on delete set null,
  image_qty integer not null check (image_qty > 0),
  price numeric not null check (price >= 0),
  payment_method text not null default 'pix',
  pagbank_order_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_affiliate_ai_purchases_partnership
  on public.affiliate_ai_purchases (partnership_id, paid_at);

-- Extrato de acerto com o afiliado — mesmo molde do fiado (saldo na
-- parceria + transações + gatilho que mantém tudo sincronizado sozinho).
create table if not exists public.affiliate_settlement_transactions (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid references public.affiliate_partnerships(id) on delete cascade not null,
  type text not null check (type in ('venda', 'repasse', 'estorno')),
  amount numeric not null check (amount > 0),
  order_id uuid references public.orders(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_affiliate_settlement_transactions_partnership
  on public.affiliate_settlement_transactions (partnership_id);

-- Ponto de retirada por loja envolvida num pedido — pedido que junta hub +
-- afiliados vira um checklist de retiradas pro entregador. "store_id"
-- aponta pra loja daquele ponto específico (o hub ou um dos módulos);
-- "order_id" sempre aponta pro pedido, que é sempre feito contra a loja
-- do hub.
create table if not exists public.affiliate_order_stops (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade not null,
  store_id uuid references public.stores(id) on delete cascade not null,
  address text not null,
  lat numeric,
  lng numeric,
  picked_up_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_affiliate_order_stops_order
  on public.affiliate_order_stops (order_id);

create index if not exists idx_affiliate_order_stops_store
  on public.affiliate_order_stops (store_id);

-- ============================================================
-- PARTE 2 — Cargo "entregador" na Equipe
-- ============================================================

alter table public.store_members drop constraint if exists store_members_role_check;
alter table public.store_members
  add constraint store_members_role_check
  check (role in ('completo', 'caixa', 'entregador'));

-- Nenhuma coluna hoje registra QUANDO um pedido virou "entregue" (o projeto
-- não usa updated_at genérico em lugar nenhum — segue o padrão de coluna
-- nomeada por evento, tipo pix_paid_at/card_paid_at). Sem isso, a tela de
-- entregas não tem como contar "quantas entregas hoje/essa semana" de
-- verdade. Nullable, preenchida pela própria tela ao marcar entregue.
alter table public.orders add column if not exists delivered_at timestamptz;

-- Sem função nova aqui de propósito: my_pdv_store_ids() já devolve a loja
-- de qualquer membro da equipe, de qualquer cargo (o filtro fino sempre
-- foi feito na policy de cada tabela, não na função) — então o cargo
-- "entregador" já é enxergado por ela automaticamente, igual "caixa" já é.

-- A policy histórica de "orders" (schema-v33) só libera select/update pra
-- quem cai em my_store_ids() (cargo completo) — o cargo entregador (e o
-- caixa, que também cai em my_pdv_store_ids) nunca teve acesso nenhum à
-- tabela orders. Sem isso, a tela de entregas não vê pedido nenhum, e a
-- policy de affiliate_order_stops mais abaixo (que faz "order_id in
-- (select id from orders where ...)") também voltaria vazia pra esse
-- cargo, porque a subquery roda sob a RLS de quem está logado, não com
-- privilégio elevado. Adicionar (não trocar) a policy existente — dono
-- continua com acesso completo por my_store_ids(), isso aqui só soma
-- acesso pro cargo de entrega, restrito à própria loja.
drop policy if exists "equipe de entrega ve e atualiza pedidos da loja" on public.orders;
create policy "equipe de entrega ve e atualiza pedidos da loja" on public.orders for select
  using (store_id in (select public.my_pdv_store_ids()));

drop policy if exists "equipe de entrega atualiza status do pedido" on public.orders;
create policy "equipe de entrega atualiza status do pedido" on public.orders for update
  using (store_id in (select public.my_pdv_store_ids()))
  with check (store_id in (select public.my_pdv_store_ids()));

-- ============================================================
-- PARTE 3 — Funções auxiliares
-- ============================================================

-- Confirma se a loja do usuário logado é parceira ativa daquele hub —
-- usado nas políticas de leitura (o afiliado precisa ver preço/extras/
-- padrão de qualidade do hub, mesmo sem poder editar nada disso).
create or replace function public.is_affiliate_partner(p_hub_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.affiliate_partnerships hp
    where hp.hub_store_id = p_hub_store_id
      and hp.module_store_id in (select public.my_store_ids())
      and hp.active
  )
$$;

grant execute on function public.is_affiliate_partner(uuid) to authenticated;

-- Popula os extras e pacotes de IA com os valores padrão assim que a loja
-- liga o módulo de afiliados pela primeira vez (cria a linha em
-- affiliate_settings) — mesma ideia do gatilho que já dá o plano "Grátis"
-- pra loja nova.
create or replace function public.seed_affiliate_defaults()
returns trigger
language plpgsql
as $$
begin
  insert into public.affiliate_extras (hub_store_id, code, name, price_monthly, included_in_padrao)
  values
    (new.hub_store_id, 'destaque_home', 'Destaque na home', 39.90, false),
    (new.hub_store_id, 'cupom_proprio', 'Cupom próprio', 19.90, false),
    (new.hub_store_id, 'banner_personalizado', 'Banner personalizado', 0, true),
    (new.hub_store_id, 'campanha_whatsapp', 'Campanha no WhatsApp', 29.90, false),
    (new.hub_store_id, 'relatorios_avancados', 'Relatórios avançados', 14.90, false),
    (new.hub_store_id, 'raspadinha_propria', 'Raspadinha própria', 19.90, false),
    (new.hub_store_id, 'assinatura_recorrente', 'Assinatura recorrente', 19.90, false)
  on conflict (hub_store_id, code) do nothing;

  insert into public.affiliate_ai_packages (hub_store_id, qty, price, is_custom)
  values
    (new.hub_store_id, 5, 12.50, false),
    (new.hub_store_id, 20, 45.00, false),
    (new.hub_store_id, 30, 60.00, false);

  return new;
end;
$$;

drop trigger if exists seed_affiliate_defaults_trigger on public.affiliate_settings;
create trigger seed_affiliate_defaults_trigger
  after insert on public.affiliate_settings
  for each row execute function public.seed_affiliate_defaults();

-- Mantém affiliate_partnerships.balance sempre sincronizado — nunca
-- calculado à mão no client. 'venda' soma ao saldo a repassar; 'repasse'
-- e 'estorno' descontam.
create or replace function public.apply_affiliate_settlement_transaction()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'venda' then
    update public.affiliate_partnerships set balance = balance + new.amount where id = new.partnership_id;
  else
    update public.affiliate_partnerships set balance = balance - new.amount where id = new.partnership_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_affiliate_settlement_transaction_insert on public.affiliate_settlement_transactions;
create trigger on_affiliate_settlement_transaction_insert
  after insert on public.affiliate_settlement_transactions
  for each row execute function public.apply_affiliate_settlement_transaction();

-- Registra uma imagem gerada/editada por IA, mas só se ainda sobrar cota
-- (cota do plano + pacotes pagos e confirmados nesse mês). Bloqueia com
-- erro quando esgotou — o cliente (afiliado) precisa comprar um pacote
-- antes de continuar.
create or replace function public.affiliate_generate_ai_image(p_partnership_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hub_store_id uuid;
  v_base_quota numeric;
  v_used numeric;
  v_extra numeric;
begin
  if p_kind not in ('gerada', 'editada') then
    raise exception 'Tipo de imagem inválido';
  end if;

  select hp.hub_store_id into v_hub_store_id
  from public.affiliate_partnerships hp
  where hp.id = p_partnership_id
    and hp.module_store_id in (select public.my_store_ids())
    and hp.active;

  if v_hub_store_id is null then
    raise exception 'Parceria não encontrada ou sem permissão';
  end if;

  select coalesce(hp.ai_quota_monthly, s.ai_quota_monthly_default)
  into v_base_quota
  from public.affiliate_partnerships hp
  join public.affiliate_settings s on s.hub_store_id = hp.hub_store_id
  where hp.id = p_partnership_id;

  select count(*) into v_used
  from public.affiliate_ai_image_events
  where partnership_id = p_partnership_id
    and created_at >= date_trunc('month', now());

  select coalesce(sum(image_qty), 0) into v_extra
  from public.affiliate_ai_purchases
  where partnership_id = p_partnership_id
    and paid_at is not null
    and paid_at >= date_trunc('month', now());

  if v_used >= (coalesce(v_base_quota, 0) + v_extra) then
    raise exception 'Cota de imagens esgotada';
  end if;

  insert into public.affiliate_ai_image_events (partnership_id, kind)
  values (p_partnership_id, p_kind);
end;
$$;

grant execute on function public.affiliate_generate_ai_image(uuid, text) to authenticated;

-- ============================================================
-- PARTE 4 — RLS
-- ============================================================

alter table public.affiliate_partnerships enable row level security;

drop policy if exists "dono gerencia parcerias da propria loja" on public.affiliate_partnerships;
create policy "dono gerencia parcerias da propria loja" on public.affiliate_partnerships for all
  using (hub_store_id in (select public.my_store_ids()))
  with check (hub_store_id in (select public.my_store_ids()));

drop policy if exists "afiliado ve a propria parceria" on public.affiliate_partnerships;
create policy "afiliado ve a propria parceria" on public.affiliate_partnerships for select
  using (module_store_id in (select public.my_store_ids()));

alter table public.affiliate_settings enable row level security;

drop policy if exists "dono gerencia preco do proprio hub" on public.affiliate_settings;
create policy "dono gerencia preco do proprio hub" on public.affiliate_settings for all
  using (hub_store_id in (select public.my_store_ids()))
  with check (hub_store_id in (select public.my_store_ids()));

drop policy if exists "afiliado ve preco do hub" on public.affiliate_settings;
create policy "afiliado ve preco do hub" on public.affiliate_settings for select
  using (public.is_affiliate_partner(hub_store_id));

alter table public.affiliate_extras enable row level security;

drop policy if exists "dono gerencia extras do proprio hub" on public.affiliate_extras;
create policy "dono gerencia extras do proprio hub" on public.affiliate_extras for all
  using (hub_store_id in (select public.my_store_ids()))
  with check (hub_store_id in (select public.my_store_ids()));

drop policy if exists "afiliado ve extras do hub" on public.affiliate_extras;
create policy "afiliado ve extras do hub" on public.affiliate_extras for select
  using (public.is_affiliate_partner(hub_store_id));

alter table public.affiliate_partnership_extras enable row level security;

drop policy if exists "dono gerencia extras ligados da propria parceria" on public.affiliate_partnership_extras;
create policy "dono gerencia extras ligados da propria parceria" on public.affiliate_partnership_extras for all
  using (partnership_id in (
    select id from public.affiliate_partnerships where hub_store_id in (select public.my_store_ids())
  ))
  with check (partnership_id in (
    select id from public.affiliate_partnerships where hub_store_id in (select public.my_store_ids())
  ));

drop policy if exists "afiliado ve os proprios extras ligados" on public.affiliate_partnership_extras;
create policy "afiliado ve os proprios extras ligados" on public.affiliate_partnership_extras for select
  using (partnership_id in (
    select id from public.affiliate_partnerships where module_store_id in (select public.my_store_ids())
  ));

alter table public.affiliate_ai_packages enable row level security;

drop policy if exists "dono gerencia pacotes de ia do proprio hub" on public.affiliate_ai_packages;
create policy "dono gerencia pacotes de ia do proprio hub" on public.affiliate_ai_packages for all
  using (hub_store_id in (select public.my_store_ids()))
  with check (hub_store_id in (select public.my_store_ids()));

drop policy if exists "afiliado ve pacotes de ia do hub" on public.affiliate_ai_packages;
create policy "afiliado ve pacotes de ia do hub" on public.affiliate_ai_packages for select
  using (
    (partnership_id is null and public.is_affiliate_partner(hub_store_id))
    or partnership_id in (
      select id from public.affiliate_partnerships where module_store_id in (select public.my_store_ids())
    )
  );

alter table public.affiliate_ai_image_events enable row level security;

drop policy if exists "dono ve uso de ia dos afiliados" on public.affiliate_ai_image_events;
create policy "dono ve uso de ia dos afiliados" on public.affiliate_ai_image_events for select
  using (partnership_id in (
    select id from public.affiliate_partnerships where hub_store_id in (select public.my_store_ids())
  ));

drop policy if exists "afiliado ve o proprio uso de ia" on public.affiliate_ai_image_events;
create policy "afiliado ve o proprio uso de ia" on public.affiliate_ai_image_events for select
  using (partnership_id in (
    select id from public.affiliate_partnerships where module_store_id in (select public.my_store_ids())
  ));

alter table public.affiliate_ai_purchases enable row level security;

drop policy if exists "dono ve compras de pacote dos afiliados" on public.affiliate_ai_purchases;
create policy "dono ve compras de pacote dos afiliados" on public.affiliate_ai_purchases for select
  using (partnership_id in (
    select id from public.affiliate_partnerships where hub_store_id in (select public.my_store_ids())
  ));

drop policy if exists "afiliado ve as proprias compras de pacote" on public.affiliate_ai_purchases;
create policy "afiliado ve as proprias compras de pacote" on public.affiliate_ai_purchases for select
  using (partnership_id in (
    select id from public.affiliate_partnerships where module_store_id in (select public.my_store_ids())
  ));

alter table public.affiliate_settlement_transactions enable row level security;

drop policy if exists "dono ve e ajusta acerto dos afiliados" on public.affiliate_settlement_transactions;
create policy "dono ve e ajusta acerto dos afiliados" on public.affiliate_settlement_transactions for all
  using (partnership_id in (
    select id from public.affiliate_partnerships where hub_store_id in (select public.my_store_ids())
  ))
  with check (partnership_id in (
    select id from public.affiliate_partnerships where hub_store_id in (select public.my_store_ids())
  ));

drop policy if exists "afiliado ve o proprio extrato de acerto" on public.affiliate_settlement_transactions;
create policy "afiliado ve o proprio extrato de acerto" on public.affiliate_settlement_transactions for select
  using (partnership_id in (
    select id from public.affiliate_partnerships where module_store_id in (select public.my_store_ids())
  ));

alter table public.affiliate_order_stops enable row level security;

-- O dono gerencia os pontos de retirada de qualquer pedido feito contra a
-- própria loja do hub (o pedido é sempre feito contra o hub, nunca contra
-- o módulo do afiliado direto).
drop policy if exists "dono gerencia pontos de entrega dos proprios pedidos" on public.affiliate_order_stops;
create policy "dono gerencia pontos de entrega dos proprios pedidos" on public.affiliate_order_stops for all
  using (order_id in (
    select id from public.orders where store_id in (select public.my_store_ids())
  ))
  with check (order_id in (
    select id from public.orders where store_id in (select public.my_store_ids())
  ));

-- Cargo entregador (e caixa, que também cai em my_pdv_store_ids) vê e
-- atualiza os pontos de retirada pelo PEDIDO, não pelo ponto individual —
-- assim ele enxerga a rota inteira (sua loja + cada módulo envolvido),
-- não só o pedaço que pertence à própria loja dele.
drop policy if exists "equipe de entrega ve e atualiza pontos de retirada" on public.affiliate_order_stops;
create policy "equipe de entrega ve e atualiza pontos de retirada" on public.affiliate_order_stops for all
  using (order_id in (
    select id from public.orders where store_id in (select public.my_pdv_store_ids())
  ))
  with check (order_id in (
    select id from public.orders where store_id in (select public.my_pdv_store_ids())
  ));

-- O afiliado só precisa ver o próprio ponto de retirada dele, não o
-- pedido inteiro — esse aqui é pelo store_id direto do ponto, não pelo
-- pedido.
drop policy if exists "afiliado ve o proprio ponto de retirada" on public.affiliate_order_stops;
create policy "afiliado ve o proprio ponto de retirada" on public.affiliate_order_stops for select
  using (store_id in (select public.my_store_ids()));
