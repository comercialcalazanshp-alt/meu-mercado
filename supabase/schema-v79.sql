-- Meu Mercado — v79.
-- Central de Reclamações: cliente relata um problema com um pedido
-- específico (produto errado, danificado, atraso, etc.), o dono vê tudo
-- num painel só, responde e marca como resolvida. Diferente de Avaliações
-- (nota geral da loja/produto, sem vínculo com pedido e sem fluxo de
-- status) e de Mensagens (só gera link de WhatsApp, não guarda nada).

create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  order_id uuid references public.orders(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  category text not null check (category in (
    'produto_errado', 'produto_danificado', 'faltou_item',
    'atraso_entrega', 'cobranca_errada', 'atendimento', 'outro'
  )),
  description text not null,
  status text not null default 'aberta' check (status in ('aberta', 'em_andamento', 'resolvida')),
  owner_reply text,
  owner_reply_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_complaints_store on public.complaints (store_id, status);
create index if not exists idx_complaints_order on public.complaints (order_id);

alter table public.complaints enable row level security;

-- Sem policy pública de select/insert de propósito — igual checkout() e
-- get_order_receipt, o cliente nunca lê/escreve a tabela direto (evitaria
-- vazar reclamação de outro cliente pra quem descobrir um id por
-- tentativa). Toda a interação passa pelas funções security definer
-- abaixo, que validam o pedido antes de fazer qualquer coisa.
drop policy if exists "dono gerencia reclamacoes da propria loja" on public.complaints;
create policy "dono gerencia reclamacoes da propria loja" on public.complaints for all
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter table public.stores add column if not exists complaint_notification_enabled boolean not null default true;

-- Abre uma reclamação a partir do id do pedido (mesmo padrão de posse por
-- link já usado em get_order_receipt/checkout) — nome/telefone vêm do
-- próprio pedido, o cliente não precisa digitar de novo.
create or replace function public.file_complaint(
  p_order_id uuid,
  p_category text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order record;
  v_complaint_id uuid;
begin
  select id, store_id, customer_name, customer_phone into v_order
  from public.orders where id = p_order_id;

  if not found then
    raise exception 'Pedido não encontrado';
  end if;

  if p_description is null or trim(p_description) = '' then
    raise exception 'Descreva o problema';
  end if;

  if p_category not in (
    'produto_errado', 'produto_danificado', 'faltou_item',
    'atraso_entrega', 'cobranca_errada', 'atendimento', 'outro'
  ) then
    raise exception 'Categoria inválida';
  end if;

  insert into public.complaints (store_id, order_id, customer_name, customer_phone, category, description)
  values (v_order.store_id, v_order.id, v_order.customer_name, v_order.customer_phone, p_category, trim(p_description))
  returning id into v_complaint_id;

  return v_complaint_id;
end;
$$;

grant execute on function public.file_complaint(uuid, text, text) to anon, authenticated;

-- Devolve a reclamação mais recente de um pedido, pro cliente ver o status
-- e a resposta do dono ao reabrir a página do recibo.
create or replace function public.get_order_complaint(p_order_id uuid)
returns table (
  id uuid,
  category text,
  description text,
  status text,
  owner_reply text,
  owner_reply_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.category, c.description, c.status, c.owner_reply, c.owner_reply_at, c.created_at
  from public.complaints c
  where c.order_id = p_order_id
  order by c.created_at desc
  limit 1;
$$;

grant execute on function public.get_order_complaint(uuid) to anon, authenticated;

-- Avisa o dono na hora (não espera o cron de 15min — reclamação é urgente)
-- igual já acontece pra pedido novo (schema-v35). "coalesce(..., true)"
-- porque lojas de antes dessa coluna existir também devem ser avisadas.
create extension if not exists pg_net;

create or replace function public.notify_new_complaint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  select complaint_notification_enabled into v_enabled from public.stores where id = new.store_id;

  if coalesce(v_enabled, true) then
    perform net.http_post(
      url := 'https://meu-mercado-blond.vercel.app/api/push/send-complaint-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-secret', '287b8dfeda0b85a9219e22d49e16fd0e05a1ef345aa661f1'
      ),
      body := jsonb_build_object(
        'store_id', new.store_id,
        'complaint_id', new.id,
        'customer_name', new.customer_name,
        'category', new.category
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_complaint_insert on public.complaints;
create trigger on_complaint_insert
  after insert on public.complaints
  for each row execute function public.notify_new_complaint();
