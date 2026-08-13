-- Meu Mercado — v45.
-- Kits: edição completa (categoria, prazo, foto por IA depois), componente
-- por peso, histórico de preço, kit no PDV, estatística de venda do kit e
-- sugestão automática de kit por produtos comprados juntos.

alter table public.kits add column if not exists category text;
alter table public.kits add column if not exists starts_at timestamptz;
alter table public.kits add column if not exists ends_at timestamptz;

-- Componente de kit por peso (ex: 500g de picanha) precisa de quantidade
-- fracionada, não só número inteiro de unidades.
alter table public.kit_items alter column quantity type numeric using quantity::numeric;

-- Histórico de preço do kit, mesmo padrão de product_price_history.
create table if not exists public.kit_price_history (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid references public.kits(id) on delete cascade not null,
  store_id uuid references public.stores(id) on delete cascade not null,
  price numeric not null,
  changed_at timestamptz not null default now()
);

alter table public.kit_price_history enable row level security;

drop policy if exists "dono ve historico de preco dos proprios kits" on public.kit_price_history;
create policy "dono ve historico de preco dos proprios kits" on public.kit_price_history for select
  using (store_id in (select public.my_store_ids()));

create or replace function public.log_kit_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.price is distinct from old.price then
    insert into public.kit_price_history (kit_id, store_id, price)
    values (new.id, new.store_id, new.price);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_kit_price_change on public.kits;
create trigger trg_log_kit_price_change
  after insert or update on public.kits
  for each row execute function public.log_kit_price_change();

insert into public.kit_price_history (kit_id, store_id, price)
select id, store_id, price from public.kits
where not exists (select 1 from public.kit_price_history where kit_id = kits.id);

-- pdv_sale passa a aceitar itens com kit_id, descontando o estoque de cada
-- componente (multiplicado pela quantidade de kits vendida), igual o
-- checkout do site já faz.
create or replace function public.pdv_sale(
  p_store_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text default 'Cliente balcão',
  p_customer_phone text default null,
  p_payments jsonb default null,
  p_discount_amount numeric default 0
)
returns table (order_id uuid, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_component record;
  v_kit record;
  v_product record;
  v_quantity numeric;
  v_needed numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_customer_id uuid;
  v_is_split boolean := p_payments is not null and jsonb_array_length(p_payments) > 1;
  v_pay jsonb;
  v_pay_sum numeric := 0;
  v_fiado_amount numeric := 0;
  v_discount numeric := coalesce(p_discount_amount, 0);
  v_combo_sets numeric;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  if p_payment_method not in ('dinheiro', 'pix', 'cartao', 'fiado', 'dividido') then
    raise exception 'Forma de pagamento inválida';
  end if;

  if v_discount < 0 then
    raise exception 'Desconto inválido';
  end if;

  if v_is_split then
    for v_pay in select * from jsonb_array_elements(p_payments)
    loop
      if (v_pay->>'method') not in ('dinheiro', 'pix', 'cartao', 'fiado') then
        raise exception 'Forma de pagamento inválida na divisão';
      end if;
      if (v_pay->>'amount')::numeric <= 0 then
        raise exception 'Valor inválido na divisão de pagamento';
      end if;
      v_pay_sum := v_pay_sum + (v_pay->>'amount')::numeric;
      if v_pay->>'method' = 'fiado' then
        v_fiado_amount := v_fiado_amount + (v_pay->>'amount')::numeric;
      end if;
    end loop;

    if v_fiado_amount > 0 and (p_customer_phone is null or trim(p_customer_phone) = '') then
      raise exception 'A parte no crediário precisa do WhatsApp do cliente';
    end if;
  else
    if p_payment_method = 'fiado' and (p_customer_phone is null or trim(p_customer_phone) = '') then
      raise exception 'Venda fiado precisa do WhatsApp do cliente';
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Carrinho vazio';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida';
    end if;

    if v_item ? 'kit_id' then
      select id, name, price into v_kit
      from public.kits
      where id = (v_item->>'kit_id')::uuid
        and store_id = p_store_id
        and active = true;

      if not found then
        raise exception 'Um dos kits não está mais disponível';
      end if;

      for v_component in
        select product_id, quantity from public.kit_items where kit_id = v_kit.id
      loop
        select id, name, stock into v_product
        from public.products
        where id = v_component.product_id
          and store_id = p_store_id
        for update;

        if not found then
          raise exception 'Um produto do kit "%" não está mais disponível', v_kit.name;
        end if;

        v_needed := v_component.quantity * v_quantity;

        if v_product.stock < v_needed then
          raise exception 'Estoque insuficiente pro kit "%": falta "%"', v_kit.name, v_product.name;
        end if;

        update public.products set stock = stock - v_needed where id = v_product.id;
      end loop;

      v_line_total := v_kit.price * v_quantity;
      v_total := v_total + v_line_total;
      v_order_items := v_order_items || jsonb_build_object(
        'name', 'Kit: ' || v_kit.name,
        'price', v_kit.price,
        'quantity', v_quantity,
        'kit_id', v_kit.id,
        'line_total', v_line_total
      );
    else
      select id, name, price, stock, promo_buy_qty, promo_pay_qty,
             price_wholesale, wholesale_min_qty, price_fiado, on_offer, offer_price, sold_by_weight
        into v_product
      from public.products
      where id = (v_item->>'product_id')::uuid
        and store_id = p_store_id
      for update;

      if not found then
        raise exception 'Um dos produtos não foi encontrado';
      end if;

      if v_product.stock < v_quantity then
        raise exception 'Estoque insuficiente para "%": só tem % disponível', v_product.name, v_product.stock;
      end if;

      update public.products set stock = stock - v_quantity where id = v_product.id;

      if not v_is_split and p_payment_method = 'fiado' and v_product.price_fiado is not null then
        v_line_total := v_product.price_fiado * v_quantity;
        v_unit_price := v_product.price_fiado;
      elsif v_product.on_offer and v_product.offer_price is not null then
        v_line_total := v_product.offer_price * v_quantity;
        v_unit_price := v_product.offer_price;
      elsif v_product.price_wholesale is not null and v_quantity >= v_product.wholesale_min_qty then
        v_line_total := v_product.price_wholesale * v_quantity;
        v_unit_price := v_product.price_wholesale;
      elsif not v_product.sold_by_weight and v_product.promo_buy_qty is not null and v_quantity >= v_product.promo_buy_qty then
        v_combo_sets := trunc(v_quantity / v_product.promo_buy_qty);
        v_line_total := (
          v_combo_sets * v_product.promo_pay_qty
          + (v_quantity - v_combo_sets * v_product.promo_buy_qty)
        ) * v_product.price;
        v_unit_price := v_product.price;
      else
        v_line_total := v_product.price * v_quantity;
        v_unit_price := v_product.price;
      end if;

      v_total := v_total + v_line_total;
      v_order_items := v_order_items || jsonb_build_object(
        'name', v_product.name,
        'price', v_unit_price,
        'quantity', v_quantity,
        'product_id', v_product.id,
        'line_total', v_line_total,
        'sold_by_weight', v_product.sold_by_weight
      );
    end if;
  end loop;

  if v_discount > v_total then
    raise exception 'O desconto não pode ser maior que o total da venda';
  end if;

  v_total := v_total - v_discount;

  if v_is_split and round(v_pay_sum, 2) <> round(v_total, 2) then
    raise exception 'A soma das formas de pagamento (%) não bate com o total (%)', v_pay_sum, v_total;
  end if;

  insert into public.orders (
    store_id, customer_name, customer_phone, items, total, status, channel,
    payment_method, payment_split, discount_amount
  )
  values (
    p_store_id,
    coalesce(nullif(trim(p_customer_name), ''), 'Cliente balcão'),
    coalesce(nullif(trim(p_customer_phone), ''), 'balcão'),
    v_order_items,
    v_total,
    'entregue',
    'balcao',
    case when v_is_split then 'dividido' else p_payment_method end,
    case when v_is_split then p_payments else null end,
    v_discount
  )
  returning id into v_order_id;

  if (v_is_split and v_fiado_amount > 0) or (not v_is_split and p_payment_method = 'fiado') then
    insert into public.credit_customers (store_id, name, phone)
    values (p_store_id, coalesce(nullif(trim(p_customer_name), ''), 'Cliente balcão'), trim(p_customer_phone))
    on conflict (store_id, phone) do update set name = excluded.name
    returning id into v_customer_id;

    insert into public.credit_transactions (customer_id, type, amount, note)
    values (
      v_customer_id,
      'venda',
      case when v_is_split then v_fiado_amount else v_total end,
      'Venda no balcão (PDV)'
    );
  end if;

  return query select v_order_id, v_total;
end;
$$;

-- Estatística de venda por kit: mesma ideia de product_sales_stats, mas
-- olhando pros itens de pedido que têm kit_id em vez de product_id. Lucro
-- é calculado somando o custo dos componentes (quando todos tiverem custo
-- cadastrado).
create or replace function public.kit_sales_stats(p_store_id uuid, p_days int default 30)
returns table (
  kit_id uuid,
  units_sold_recent numeric,
  revenue_recent numeric,
  profit_recent numeric,
  avg_daily_sales numeric,
  last_sold_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  return query
  with items as (
    select
      (elem->>'kit_id')::uuid as kid,
      (elem->>'quantity')::numeric as qty,
      coalesce(
        (elem->>'line_total')::numeric,
        (elem->>'price')::numeric * (elem->>'quantity')::numeric
      ) as line_revenue,
      o.created_at
    from public.orders o, jsonb_array_elements(o.items) as elem
    where o.store_id = p_store_id
      and o.status <> 'cancelado'
      and elem ? 'kit_id'
  ),
  recent as (
    select kid, sum(qty) as units, sum(line_revenue) as revenue
    from items
    where created_at >= now() - (greatest(p_days, 1) || ' days')::interval
    group by kid
  ),
  last_sale as (
    select kid, max(created_at) as last_at
    from items
    group by kid
  ),
  kit_cost as (
    select
      ki.kit_id,
      case when bool_and(p.cost_price is not null) then sum(ki.quantity * p.cost_price) else null end as cost
    from public.kit_items ki
    join public.products p on p.id = ki.product_id
    group by ki.kit_id
  )
  select
    k.id,
    coalesce(recent.units, 0),
    coalesce(recent.revenue, 0),
    case when kit_cost.cost is not null
      then coalesce(recent.revenue, 0) - coalesce(recent.units, 0) * kit_cost.cost
      else null
    end,
    round(coalesce(recent.units, 0) / greatest(p_days, 1), 3),
    last_sale.last_at
  from public.kits k
  left join recent on recent.kid = k.id
  left join last_sale on last_sale.kid = k.id
  left join kit_cost on kit_cost.kit_id = k.id
  where k.store_id = p_store_id;
end;
$$;

-- Sugestão automática de kit: quais pares de produto são comprados juntos
-- com mais frequência (dentro do mesmo pedido), pra virar ideia de kit.
-- Ignora pares que já estão juntos em algum kit ativo.
create or replace function public.suggest_kit_pairs(p_store_id uuid, p_days int default 90, p_limit int default 5)
returns table (
  product_a_id uuid,
  product_a_name text,
  product_b_id uuid,
  product_b_name text,
  times_bought_together bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  return query
  with order_products as (
    select distinct o.id as order_id, (elem->>'product_id')::uuid as pid
    from public.orders o, jsonb_array_elements(o.items) as elem
    where o.store_id = p_store_id
      and o.status <> 'cancelado'
      and elem ? 'product_id'
      and o.created_at >= now() - (greatest(p_days, 1) || ' days')::interval
  ),
  pairs as (
    select a.pid as pa, b.pid as pb, count(*) as together
    from order_products a
    join order_products b on a.order_id = b.order_id and a.pid < b.pid
    group by a.pid, b.pid
    having count(*) >= 2
  ),
  already_kitted as (
    select least(ki1.product_id, ki2.product_id) as pa, greatest(ki1.product_id, ki2.product_id) as pb
    from public.kit_items ki1
    join public.kit_items ki2 on ki1.kit_id = ki2.kit_id and ki1.product_id < ki2.product_id
    join public.kits k on k.id = ki1.kit_id and k.active = true
  )
  select pa.id, pa.name, pb.id, pb.name, pairs.together
  from pairs
  join public.products pa on pa.id = pairs.pa and pa.store_id = p_store_id and pa.active = true
  join public.products pb on pb.id = pairs.pb and pb.store_id = p_store_id and pb.active = true
  where not exists (
    select 1 from already_kitted ak where ak.pa = pairs.pa and ak.pb = pairs.pb
  )
  order by pairs.together desc
  limit greatest(p_limit, 1);
end;
$$;
