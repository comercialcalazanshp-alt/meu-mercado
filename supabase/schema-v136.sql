-- Login do admin da plataforma (não é o painel de loja) não tinha nenhum
-- limite de tentativa — uma senha estática, comparada com timingSafeEqual
-- (bom), mas sem bloqueio nenhum contra um script tentando adivinhar. Quem
-- entra aí controla toda loja da plataforma (ativar/desativar, mudar plano).
-- Guarda tentativa falha por IP com bloqueio temporário depois de 5 erros,
-- do mesmo jeito que o login do cliente já faz.
create table if not exists public.admin_login_attempts (
  identifier text primary key,
  failed_count int not null default 0,
  last_attempt_at timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.admin_login_attempts enable row level security;
-- Sem nenhuma policy pra authenticated/anon de propósito: só a chave de
-- serviço (usada no server action) acessa essa tabela.
