-- Alertas automáticos proativos (push): estoque baixo, pedido parado,
-- entrega demorando. Um job periódico (vercel cron -> /api/cron/check-alerts)
-- varre todas as lojas e manda push pros donos que tiverem cada tipo ligado.

alter table public.stores add column if not exists alert_low_stock_enabled boolean not null default true;
alter table public.stores add column if not exists alert_stalled_order_enabled boolean not null default true;
alter table public.stores add column if not exists alert_delivery_delay_enabled boolean not null default true;

-- Sem isso, não existe como saber QUANDO um pedido entrou em "a caminho" —
-- delivered_at só marca o fim da entrega, nunca o início. Segue o mesmo
-- padrão de coluna nomeada por evento já usado em delivered_at (v73).
alter table public.orders add column if not exists out_for_delivery_at timestamptz;

-- Registro do que já foi alertado, pra não mandar o mesmo aviso de novo a
-- cada rodada do cron — um produto com estoque baixo só alerta de novo
-- depois de ALERT_COOLDOWN_HOURS (ver route.ts) sem alerta novo pra ele.
create table if not exists public.alert_notifications_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  alert_type text not null check (alert_type in ('estoque_baixo', 'pedido_parado', 'entrega_demorada')),
  entity_id uuid not null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_alert_log_dedup
  on public.alert_notifications_log (store_id, alert_type, entity_id, sent_at desc);

alter table public.alert_notifications_log enable row level security;

drop policy if exists "dono ve o proprio historico de alertas" on public.alert_notifications_log;
create policy "dono ve o proprio historico de alertas" on public.alert_notifications_log for select
  using (store_id in (select public.my_store_ids()));
