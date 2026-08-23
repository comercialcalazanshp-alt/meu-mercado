-- Meu Mercado — v115.
-- Assistente de IA único no painel (não um por área — só um, que já
-- conhece financeiro/marketing/vendas/entrega da loja). Guarda o
-- histórico de conversa por loja, pra continuar de onde parou.
create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_assistant_messages_store on public.assistant_messages(store_id, created_at);

alter table public.assistant_messages enable row level security;

drop policy if exists "dono ve e apaga conversa do assistente da propria loja" on public.assistant_messages;
create policy "dono ve e apaga conversa do assistente da propria loja" on public.assistant_messages for select
  using (store_id in (select public.my_store_ids()));

drop policy if exists "dono apaga conversa do assistente da propria loja" on public.assistant_messages;
create policy "dono apaga conversa do assistente da propria loja" on public.assistant_messages for delete
  using (store_id in (select public.my_store_ids()));

-- Inserção só pela rota do servidor (chave de serviço) — o cliente nunca
-- grava direto, porque a resposta do assistente também precisa ser
-- salva com o mesmo request, sem depender do navegador continuar aberto.
