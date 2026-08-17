-- Meu Mercado — v78.
-- 3 ideias novas em cima da infra de alertas (v75/v76): resumo semanal
-- automático, alerta de meta de vendas batida, e push também pro
-- entregador (não só o dono) — pra isso, push_subscriptions passa a saber
-- de QUEM é a inscrição, não só de qual loja.

alter table public.push_subscriptions add column if not exists member_id uuid references public.store_members(id) on delete cascade;

alter table public.stores add column if not exists alert_goal_reached_enabled boolean not null default true;
alter table public.stores add column if not exists weekly_summary_enabled boolean not null default true;

-- 'meta_batida' entra no mesmo catálogo de tipo de alerta já usado pelos
-- outros 3 (schema-v75) — precisa recriar a constraint pra aceitar o novo
-- valor. Busca o nome real da constraint em vez de supor o nome
-- auto-gerado (alter table ... drop constraint if exists com o nome
-- errado simplesmente não faz nada e deixa a constraint antiga, mais
-- restrita, ativa por baixo — o que bloquearia todo insert de
-- 'meta_batida' silenciosamente).
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.alert_notifications_log'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%alert_type%';

  if v_constraint_name is not null then
    execute format('alter table public.alert_notifications_log drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.alert_notifications_log add constraint alert_notifications_log_alert_type_check
  check (alert_type in ('estoque_baixo', 'pedido_parado', 'entrega_demorada', 'meta_batida'));

-- Resumo semanal roda 1x — segunda-feira 8h no horário de Brasília
-- (UTC-3, sem horário de verão desde 2019) = 11h UTC, que é o fuso que o
-- pg_cron do Supabase usa por padrão.
do $$
begin
  perform cron.unschedule('weekly-summary');
exception when others then
  null;
end $$;

select cron.schedule(
  'weekly-summary',
  '0 11 * * 1',
  $$
  select net.http_get(
    url := 'https://meu-mercado-blond.vercel.app/api/cron/weekly-summary',
    headers := jsonb_build_object('Authorization', 'Bearer e6780f16d14c52b664700cd8b0b209dce74afc8569ee4c16bd683e071ebfbb00')
  );
  $$
);
