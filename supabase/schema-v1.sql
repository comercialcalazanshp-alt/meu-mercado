-- Meu Mercado — esquema inicial (v1).
-- Multi-loja: cada tabela de dado sabe a qual loja pertence (store_id),
-- e o RLS garante que o dono de uma loja nunca vê o dado de outra.
-- Idempotente: seguro rodar de novo.

-- Lojas: uma linha por dono de mercadinho cadastrado na plataforma.
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) not null,
  slug text unique not null,
  name text not null,
  whatsapp text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Produtos de cada loja.
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  name text not null,
  category text,
  price numeric not null,
  image_url text,
  stock integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Pedidos de cada loja (cliente final não precisa ter conta — igual o Calazans no início).
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  customer_name text not null,
  customer_phone text not null,
  items jsonb not null,
  total numeric not null,
  status text not null default 'pendente',
  created_at timestamptz not null default now()
);

alter table stores enable row level security;
alter table products enable row level security;
alter table orders enable row level security;

-- Loja: o dono vê e edita só a própria; qualquer um (mesmo sem login) vê lojas ativas
-- (precisa pra vitrine pública funcionar).
drop policy if exists "dono gerencia a propria loja" on stores;
create policy "dono gerencia a propria loja" on stores for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "loja ativa e publica" on stores;
create policy "loja ativa e publica" on stores for select
  using (active = true);

-- Produtos: o dono gerencia os da própria loja; produto ativo é público (pro cliente ver na vitrine).
drop policy if exists "dono gerencia produtos da propria loja" on products;
create policy "dono gerencia produtos da propria loja" on products for all
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));
drop policy if exists "produto ativo e publico" on products;
create policy "produto ativo e publico" on products for select
  using (active = true);

-- Pedidos: qualquer cliente pode criar (checkout sem login); só o dono da loja lê os próprios.
drop policy if exists "qualquer um cria pedido" on orders;
create policy "qualquer um cria pedido" on orders for insert
  with check (true);
drop policy if exists "dono ve pedidos da propria loja" on orders;
create policy "dono ve pedidos da propria loja" on orders for select
  using (store_id in (select id from stores where owner_id = auth.uid()));
drop policy if exists "dono atualiza pedidos da propria loja" on orders;
create policy "dono atualiza pedidos da propria loja" on orders for update
  using (store_id in (select id from stores where owner_id = auth.uid()));
