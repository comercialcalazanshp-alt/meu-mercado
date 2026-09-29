-- Meu Mercado — v143.
-- Cobrança e bloqueio automático de fiado atrasado.
--
-- 1) A tabela customer_notes (nota interna + "Bloquear cliente") tinha o
--    create table lá na v104, mas NUNCA foi aplicada nesse banco — sumiu
--    (ou nunca existiu de verdade aqui). O checkout() da vitrine já conta
--    com ela pra recusar pedido de cliente bloqueado; sem a tabela, uma
--    compra pela vitrine de um cliente bloqueado quebraria com erro "relation
--    does not exist" em vez de simplesmente recusar. Recriando aqui (create
--    table if not exists, idempotente) antes de tudo o resto.
-- 2) Só venda fiado lançada manual (tela Clientes) tinha vencimento —
--    venda fiado do PDV (a maioria) e dívida migrada do sistema antigo não
--    tinham, então "atrasado" nunca aparecia pra elas. Backfill de
--    vencimento pras que já existem + pdv_sale() passa a gravar vencimento
--    (prazo da loja, Configurações → Crediário) em toda venda fiado nova.
-- 3) apply_credit_auto_block(): bloqueia sozinho (mesmo bloqueio que já
--    existia, manual) quem tem saldo em aberto com alguma venda vencida há
--    mais de 30 dias — nunca mexe num bloqueio que o dono fez à mão
--    (auto_blocked=false). Roda todo dia às 8h (pg_cron) e também pode ser
--    chamada na hora (pagamento, perdão de dívida, "dar mais prazo") pra
--    não esperar até o dia seguinte pra desbloquear quem regularizou.

create table if not exists public.customer_notes (
  store_id uuid not null references public.stores(id) on delete cascade,
  phone text not null,
  note text,
  blocked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (store_id, phone)
);

alter table public.customer_notes enable row level security;

drop policy if exists "dono gerencia notas de cliente da propria loja" on public.customer_notes;
create policy "dono gerencia notas de cliente da propria loja" on public.customer_notes for all
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter table public.customer_notes add column if not exists auto_blocked boolean not null default false;

-- Backfill: vencimento das vendas fiado que não tinham (created_at + prazo
-- da loja em dias; dívida do sistema antigo conta como já vencida desde que
-- foi migrada, é dívida antiga de verdade).
update public.credit_transactions ct
set due_date = ((ct.created_at at time zone 'America/Bahia')::date + (coalesce(s.credit_term_days, 30) || ' days')::interval)::date
from public.credit_customers cc
join public.stores s on s.id = cc.store_id
where ct.customer_id = cc.id
  and ct.type = 'venda'
  and ct.due_date is null
  and ct.note = 'Venda no balcão (PDV)';

update public.credit_transactions ct
set due_date = (ct.created_at at time zone 'America/Bahia')::date
from public.credit_customers cc
where ct.customer_id = cc.id
  and ct.type = 'venda'
  and ct.due_date is null
  and ct.note = 'Dívida do sistema antigo';

-- qualquer venda fiado sem vencimento que sobrar (ex: lançada manual com o
-- campo de vencimento deixado em branco) recebe o mesmo prazo padrão.
update public.credit_transactions ct
set due_date = ((ct.created_at at time zone 'America/Bahia')::date + (coalesce(s.credit_term_days, 30) || ' days')::interval)::date
from public.credit_customers cc
join public.stores s on s.id = cc.store_id
where ct.customer_id = cc.id
  and ct.type = 'venda'
  and ct.due_date is null;

-- Bloqueia/desbloqueia automaticamente por atraso de fiado. Sem
-- p_customer_id, avalia a base inteira (uso do pg_cron). Com p_customer_id,
-- avalia só esse cliente (uso do frontend, pra reagir na hora — pagamento,
-- perdão de dívida, "dar mais prazo" — sem esperar o cron do dia seguinte).
create or replace function public.apply_credit_auto_block(p_customer_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_customer_id is not null and not exists (
    select 1 from public.credit_customers cc
    where cc.id = p_customer_id and cc.store_id in (select public.my_store_ids())
  ) then
    raise exception 'Cliente não encontrado';
  end if;

  -- bloqueia quem se encaixa e ainda não está bloqueado (nunca sobrescreve
  -- um bloqueio já ativo, seja manual ou automático)
  insert into public.customer_notes (store_id, phone, blocked, auto_blocked, updated_at)
  select cc.store_id, cc.phone, true, true, now()
  from public.credit_customers cc
  where (p_customer_id is null or cc.id = p_customer_id)
    and cc.balance > 0
    and exists (
      select 1 from public.credit_transactions ct
      where ct.customer_id = cc.id and ct.type = 'venda' and ct.due_date is not null
        and ct.due_date < (current_date - 30)
    )
  on conflict (store_id, phone) do update
    set blocked = true, auto_blocked = true, updated_at = now()
    where public.customer_notes.blocked = false;

  -- desbloqueia quem o sistema bloqueou e não se encaixa mais (pagou,
  -- perdoou a dívida ou ganhou mais prazo) — nunca mexe em bloqueio manual
  update public.customer_notes cn
  set blocked = false, auto_blocked = false, updated_at = now()
  from public.credit_customers cc
  where cc.store_id = cn.store_id and cc.phone = cn.phone
    and (p_customer_id is null or cc.id = p_customer_id)
    and cn.auto_blocked = true
    and not (
      cc.balance > 0
      and exists (
        select 1 from public.credit_transactions ct
        where ct.customer_id = cc.id and ct.type = 'venda' and ct.due_date is not null
          and ct.due_date < (current_date - 30)
      )
    );
end;
$$;

grant execute on function public.apply_credit_auto_block(uuid) to authenticated;

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('apply-credit-auto-block');
exception when others then
  null;
end $$;

select cron.schedule(
  'apply-credit-auto-block',
  '0 11 * * *',
  $$ select public.apply_credit_auto_block(); $$
);

-- roda uma vez agora, pra já refletir o backfill acima sem esperar amanhã de manhã
select public.apply_credit_auto_block();

-- pdv_sale() passa a gravar vencimento em toda venda fiado nova (prazo da
-- loja). Assinatura igual à v142/v126, só muda o corpo.
create or replace function public.pdv_sale(
  p_store_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text default 'Cliente balcão',
  p_customer_phone text default null,
  p_payments jsonb default null,
  p_discount_amount numeric default 0,
  p_allow_negative_stock boolean default false
)
returns table (order_id uuid, total numeric, stock_conflict boolean)
language plpgsql
security definer
set search_path to 'public'
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
  v_offer_active boolean;
  v_stock_conflict boolean := false;
  v_credit_term_days int;
  v_due_date date;
begin
  select credit_term_days into v_credit_term_days from stores where id = p_store_id and id in (select public.my_pdv_store_ids());
  if not found then
    raise exception 'Loja não encontrada';
  end if;
  v_due_date := (current_date + (coalesce(v_credit_term_days, 30) || ' days')::interval)::date;

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
          if p_allow_negative_stock then
            v_stock_conflict := true;
          else
            raise exception 'Estoque insuficiente pro kit "%": falta "%"', v_kit.name, v_product.name;
          end if;
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
             price_wholesale, wholesale_min_qty, price_fiado, on_offer, offer_price, offer_ends_at, sold_by_weight
        into v_product
      from public.products
      where id = (v_item->>'product_id')::uuid
        and store_id = p_store_id
      for update;

      if not found then
        raise exception 'Um dos produtos não foi encontrado';
      end if;

      if v_product.stock < v_quantity then
        if p_allow_negative_stock then
          v_stock_conflict := true;
        else
          raise exception 'Estoque insuficiente para "%": só tem % disponível', v_product.name, v_product.stock;
        end if;
      end if;

      update public.products set stock = stock - v_quantity where id = v_product.id;

      v_offer_active := v_product.on_offer and v_product.offer_price is not null
        and (v_product.offer_ends_at is null or v_product.offer_ends_at > now());

      if not v_is_split and p_payment_method = 'fiado' and v_product.price_fiado is not null then
        v_line_total := v_product.price_fiado * v_quantity;
        v_unit_price := v_product.price_fiado;
      elsif v_offer_active then
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
    payment_method, payment_split, discount_amount, stock_conflict
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
    v_discount,
    v_stock_conflict
  )
  returning id into v_order_id;

  if (v_is_split and v_fiado_amount > 0) or (not v_is_split and p_payment_method = 'fiado') then
    insert into public.credit_customers (store_id, name, phone)
    values (p_store_id, coalesce(nullif(trim(p_customer_name), ''), 'Cliente balcão'), trim(p_customer_phone))
    on conflict (store_id, phone) do update set name = excluded.name
    returning id into v_customer_id;

    insert into public.credit_transactions (customer_id, type, amount, note, due_date)
    values (
      v_customer_id,
      'venda',
      case when v_is_split then v_fiado_amount else v_total end,
      'Venda no balcão (PDV)',
      v_due_date
    );
  end if;

  return query select v_order_id, v_total, v_stock_conflict;
end;
$$;
