-- Meu Mercado — v125.
-- CORREÇÃO URGENTE: a coluna blocked_by_hub (introduzida na v89) nunca
-- chegou a existir de verdade em products/banners no banco, mesmo com as
-- funções e o resto da v89 aplicados — provavelmente a migração foi
-- interrompida bem no início numa execução anterior. Como o painel de
-- Produtos consulta essa coluna pra montar a lista, TODA consulta de
-- produtos falhava silenciosamente (erro 42703 "column does not exist"),
-- e a tela de Produtos mostrava "Nenhum produto cadastrado" mesmo com
-- produtos reais cadastrados — pra qualquer loja, não só afiliado.
-- Reaplica só o que faltou da v89 (idempotente, seguro rodar de novo).
alter table public.products add column if not exists blocked_by_hub boolean not null default false;
alter table public.banners add column if not exists blocked_by_hub boolean not null default false;

drop policy if exists "produto ativo e publico" on public.products;
create policy "produto ativo e publico" on public.products for select
  using (active = true and not blocked_by_hub);

drop policy if exists "banner ativo e no prazo e publico" on public.banners;
create policy "banner ativo e no prazo e publico" on public.banners for select
  using (
    active = true
    and not blocked_by_hub
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at >= now())
  );
