-- Meu Mercado — v47.
-- Dados que aparecem no cupom impresso do PDV (CNPJ, telefone já existia via
-- whatsapp) e a largura da bobina térmica, configuráveis em Configurações.

alter table public.stores add column if not exists cnpj text;
alter table public.stores add column if not exists receipt_paper_mm integer not null default 55;
alter table public.stores add constraint stores_receipt_paper_mm_check check (receipt_paper_mm in (55, 58, 80));
