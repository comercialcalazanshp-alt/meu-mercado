-- Meu Mercado — v27.
-- Assinaturas: cliente fixo escolhe um kit por um valor mensal — todo mês
-- o dono gera o pedido dele com 1 clique, sem remontar do zero. Segue o
-- mesmo espírito do Comercial Calazans: não é cobrança automática (o
-- dono ainda combina o pagamento com o cliente), só poupa o trabalho de
-- montar o pedido toda vez.

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  customer_name text,
  customer_phone text not null,
  kit_id uuid references kits(id) on delete set null,
  monthly_amount numeric not null check (monthly_amount >= 0),
  active boolean not null default true,
  last_generated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

drop policy if exists "dono gerencia assinaturas da propria loja" on subscriptions;
create policy "dono gerencia assinaturas da propria loja" on subscriptions for all
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

-- Gera o pedido do mês pra uma assinatura: monta os itens a partir do kit
-- atual (preço e composição de hoje, não um preço congelado lá atrás),
-- insere em orders como um pedido normal (pendente, pronto pra aparecer em
-- Pedidos) e marca a data de geração. Só o dono da loja pode chamar.
create or replace function public.generate_subscription_order(p_subscription_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
  v_kit record;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
begin
  select * into v_sub
  from public.subscriptions
  where id = p_subscription_id
    and store_id in (select id from public.stores where owner_id = auth.uid());

  if not found then
    raise exception 'Assinatura não encontrada';
  end if;

  if v_sub.kit_id is null then
    raise exception 'Essa assinatura não tem um kit válido — edite e escolha outro';
  end if;

  select id, name, price into v_kit
  from public.kits
  where id = v_sub.kit_id and active = true;

  if not found then
    raise exception 'O kit dessa assinatura não existe mais — edite a assinatura e escolha outro kit';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.name,
    'price', p.price,
    'quantity', ki.quantity
  )), '[]'::jsonb)
  into v_order_items
  from public.kit_items ki
  join public.products p on p.id = ki.product_id
  where ki.kit_id = v_kit.id;

  if jsonb_array_length(v_order_items) = 0 then
    v_order_items := jsonb_build_array(jsonb_build_object('name', v_kit.name, 'price', v_sub.monthly_amount, 'quantity', 1));
  end if;

  insert into public.orders (
    store_id, customer_name, customer_phone, items, total,
    status, channel, payment_method, delivery_fee, discount_amount
  )
  values (
    v_sub.store_id,
    coalesce(v_sub.customer_name, v_sub.customer_phone),
    v_sub.customer_phone,
    v_order_items,
    v_sub.monthly_amount,
    'pendente',
    'assinatura',
    'assinatura',
    0,
    0
  )
  returning id into v_order_id;

  update public.subscriptions set last_generated_at = now() where id = v_sub.id;

  return v_order_id;
end;
$$;

grant execute on function public.generate_subscription_order(uuid) to authenticated;
