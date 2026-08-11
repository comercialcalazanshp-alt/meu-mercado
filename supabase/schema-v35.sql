-- Meu Mercado — v35.
-- Notificação push de verdade: o aviso sonoro de pedido novo (v?) só
-- funciona com o painel aberto na tela. Agora o dono pode ativar
-- notificação do sistema operacional — chega mesmo com o painel fechado
-- ou o celular bloqueado. Guarda a "inscrição" (endpoint + chaves) que o
-- navegador gera; um gatilho no banco avisa a rota de envio sempre que um
-- pedido novo entra, e ela manda o push de verdade (protocolo Web Push,
-- padrão aberto, sem precisar de serviço pago).

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "dono gerencia push da propria loja" on push_subscriptions;
create policy "dono gerencia push da propria loja" on push_subscriptions for all
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

create extension if not exists pg_net;

-- Sempre que um pedido novo é criado (site, PDV ou assinatura), avisa a
-- rota de envio de push — ela decide quem tem inscrição ativa pra essa
-- loja e manda a notificação. Roda em segundo plano (pg_net não trava a
-- venda esperando resposta) e é protegido por um segredo compartilhado,
-- pra ninguém de fora conseguir chamar a rota e mandar push falso.
create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://meu-mercado-blond.vercel.app/api/push/send-order-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', '287b8dfeda0b85a9219e22d49e16fd0e05a1ef345aa661f1'
    ),
    body := jsonb_build_object(
      'store_id', new.store_id,
      'order_id', new.id,
      'customer_name', new.customer_name,
      'total', new.total
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_new_order on orders;
create trigger trg_notify_new_order
  after insert on orders
  for each row execute function public.notify_new_order();
