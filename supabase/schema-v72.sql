-- Meu Mercado — v72.
-- A Central de Ajuda só tinha FAQ estática — se a dúvida do dono não
-- estivesse ali, não tinha pra onde ir. support_requests dá um canal de
-- verdade: o dono manda uma mensagem, ela fica registrada (não se perde
-- se ninguém responder na hora) e aparece pro admin da plataforma numa
-- fila com status aberto/respondido.
create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  sender_email text,
  message text not null,
  status text not null default 'aberto' check (status in ('aberto', 'respondido')),
  created_at timestamptz not null default now()
);

create index if not exists idx_support_requests_store on public.support_requests(store_id);

alter table public.support_requests enable row level security;

drop policy if exists "equipe envia e ve solicitacoes da propria loja" on public.support_requests;
create policy "equipe envia e ve solicitacoes da propria loja" on public.support_requests for all
  using (store_id in (select public.my_pdv_store_ids()))
  with check (store_id in (select public.my_pdv_store_ids()));
