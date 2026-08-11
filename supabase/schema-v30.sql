-- Meu Mercado — v30.
-- Histórico de preço do produto: toda vez que o preço muda (não importa se
-- foi editado na tela de Produtos, no editor em lote ou por importação CSV),
-- um gatilho no banco guarda o preço antigo com a data. Assim o dono
-- consegue ver a evolução do preço de um produto num gráfico, sem precisar
-- lembrar de registrar nada na mão.

create table if not exists product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade not null,
  store_id uuid references stores(id) on delete cascade not null,
  price numeric not null,
  changed_at timestamptz not null default now()
);

alter table product_price_history enable row level security;

drop policy if exists "dono ve historico de preco da propria loja" on product_price_history;
create policy "dono ve historico de preco da propria loja" on product_price_history for select
  using (store_id in (select id from stores where owner_id = auth.uid()));

create or replace function public.log_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.price is distinct from old.price then
    insert into public.product_price_history (product_id, store_id, price)
    values (new.id, new.store_id, new.price);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_product_price_change on products;
create trigger trg_log_product_price_change
  after insert or update on products
  for each row execute function public.log_product_price_change();

-- Preenche um primeiro ponto no histórico pra produto que já existia antes
-- dessa migração, com o preço atual, pra não começar sem nenhum dado.
insert into product_price_history (product_id, store_id, price, changed_at)
select p.id, p.store_id, p.price, p.created_at
from products p
where not exists (
  select 1 from product_price_history h where h.product_id = p.id
);
