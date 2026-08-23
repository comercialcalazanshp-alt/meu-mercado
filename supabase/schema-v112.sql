-- Meu Mercado — v112.
-- Entregador não tinha canal estruturado pra avisar a loja de um
-- problema na entrega (endereço errado, cliente ausente, recusou o
-- pedido) — só um link solto de WhatsApp pro cliente, nada que
-- notificasse o dono. Mesmo padrão de complaints (schema-v79): tabela +
-- gatilho + push.
create table if not exists public.delivery_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade not null,
  store_id uuid references public.stores(id) on delete cascade not null,
  member_id uuid references public.store_members(id) on delete set null,
  description text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_issues_store on public.delivery_issues(store_id);
create index if not exists idx_delivery_issues_order on public.delivery_issues(order_id);

alter table public.delivery_issues enable row level security;

drop policy if exists "equipe de entrega registra problema da propria loja" on public.delivery_issues;
create policy "equipe de entrega registra problema da propria loja" on public.delivery_issues for insert
  with check (store_id in (select public.my_pdv_store_ids()));

drop policy if exists "dono ve problemas de entrega da propria loja" on public.delivery_issues;
create policy "dono ve problemas de entrega da propria loja" on public.delivery_issues for select
  using (store_id in (select public.my_store_ids()));

create or replace function public.notify_delivery_issue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://meu-mercado-blond.vercel.app/api/push/send-delivery-issue-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', '287b8dfeda0b85a9219e22d49e16fd0e05a1ef345aa661f1'
    ),
    body := jsonb_build_object(
      'store_id', new.store_id,
      'order_id', new.order_id,
      'description', new.description
    )
  );
  return new;
end;
$$;

drop trigger if exists on_delivery_issue_insert on public.delivery_issues;
create trigger on_delivery_issue_insert
  after insert on public.delivery_issues
  for each row execute function public.notify_delivery_issue();
