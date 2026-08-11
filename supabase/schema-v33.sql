-- Meu Mercado — v33.
-- Multi-usuário por loja: até aqui só quem criou a conta (owner_id) conseguia
-- acessar o painel. Agora o dono pode convidar gente da equipe por e-mail —
-- quem aceita entra com acesso completo ao painel da loja (mesmo nível do
-- dono: produtos, pedidos, PDV, caixa, fiado etc.), sem precisar dividir a
-- senha da conta. A única coisa que continua exclusiva do dono de verdade é
-- convidar/remover gente da equipe e excluir a conta.
--
-- Como funciona: a pessoa convidada cria a própria conta normal em /entrar
-- (login) usando o mesmo e-mail que o dono cadastrou aqui — o cadastro dela
-- não cria uma loja nova (o gatilho de signup pula esse passo quando o
-- e-mail já está na lista de convidados). Todo o acesso é decidido comparando
-- o e-mail autenticado (nunca um ID enviado pelo navegador) com a tabela
-- store_members.

create table if not exists store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  email text not null,
  created_at timestamptz not null default now(),
  unique (store_id, email)
);

alter table store_members enable row level security;

-- Convidar/remover gente da equipe continua exclusivo do dono de verdade —
-- não usa my_store_ids() de propósito, senão um membro poderia se auto
-- promover ou remover o próprio dono.
drop policy if exists "dono gerencia membros da propria loja" on store_members;
create policy "dono gerencia membros da propria loja" on store_members for all
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

-- Devolve os ids de loja que o usuário logado pode acessar — seja como dono,
-- seja como membro convidado (comparando e-mail, nunca um id que o navegador
-- possa forjar). security definer pra poder ler stores/store_members sem
-- cair em recursão com as próprias políticas de RLS que vão chamar essa
-- função.
create or replace function public.my_store_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from stores where owner_id = auth.uid()
  union
  select sm.store_id from store_members sm
  where lower(sm.email) = lower(coalesce(auth.email(), ''))
$$;

grant execute on function public.my_store_ids() to authenticated;

-- Devolve a loja do usuário logado (dono ou membro) — usada pelo painel no
-- lugar de filtrar "stores where owner_id = ...", que só encontraria a loja
-- de quem é dono de verdade.
create or replace function public.get_my_store()
returns setof stores
language sql
security definer
stable
set search_path = public
as $$
  select s.* from stores s where s.id in (select public.my_store_ids())
$$;

grant execute on function public.get_my_store() to authenticated;

-- Se o e-mail que está se cadastrando já foi convidado pra alguma loja,
-- pula a criação de loja nova — a pessoa só precisa existir no auth.users
-- pra já enxergar a loja via my_store_ids()/get_my_store().
create or replace function public.handle_new_store_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text := coalesce(nullif(new.raw_user_meta_data->>'store_slug', ''), 'loja');
  final_slug text := base_slug;
  attempt int := 0;
begin
  if exists (
    select 1 from public.store_members where lower(email) = lower(new.email)
  ) then
    return new;
  end if;

  loop
    begin
      insert into public.stores (owner_id, slug, name, whatsapp)
      values (
        new.id,
        final_slug,
        coalesce(new.raw_user_meta_data->>'store_name', 'Minha loja'),
        nullif(new.raw_user_meta_data->>'whatsapp', '')
      );
      exit;
    exception when unique_violation then
      attempt := attempt + 1;
      final_slug := base_slug || '-' || floor(random() * 10000)::int;
      if attempt > 5 then
        raise;
      end if;
    end;
  end loop;
  return new;
end;
$$;

-- A partir daqui, troca "store_id in (select id from stores where owner_id
-- = auth.uid())" por "store_id in (select public.my_store_ids())" em toda
-- política existente — dono e membro convidado passam a ter exatamente o
-- mesmo acesso operacional.

alter policy "dono gerencia a propria loja" on stores
  using (id in (select public.my_store_ids()))
  with check (id in (select public.my_store_ids()));

alter policy "dono gerencia produtos da propria loja" on products
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono ve pedidos da propria loja" on orders
  using (store_id in (select public.my_store_ids()));

alter policy "dono atualiza pedidos da propria loja" on orders
  using (store_id in (select public.my_store_ids()));

alter policy "dono ve trafego da propria loja" on site_visits
  using (store_id in (select public.my_store_ids()));

alter policy "dono gerencia despesas da propria loja" on expenses
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono ve clientes da propria loja" on customers
  using (store_id in (select public.my_store_ids()));

alter policy "dono gerencia bairros da propria loja" on neighborhoods
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono modera avaliacoes da propria loja" on store_reviews
  using (store_id in (select public.my_store_ids()));

alter policy "dono gerencia caixa da propria loja" on cash_sessions
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono gerencia movimentos da propria loja" on cash_movements
  using (session_id in (select id from cash_sessions where store_id in (select public.my_store_ids())))
  with check (session_id in (select id from cash_sessions where store_id in (select public.my_store_ids())));

alter policy "dono gerencia assinaturas da propria loja" on subscriptions
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono gerencia receitas da propria loja" on recipes
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono ve raspadinhas da propria loja" on scratch_cards
  using (store_id in (select public.my_store_ids()));

alter policy "dono ve historico de preco da propria loja" on product_price_history
  using (store_id in (select public.my_store_ids()));

alter policy "dono gerencia cupons da propria loja" on coupons
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono gerencia banners da propria loja" on banners
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono gerencia kits da propria loja" on kits
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono gerencia itens de kit da propria loja" on kit_items
  using (kit_id in (select id from kits where store_id in (select public.my_store_ids())))
  with check (kit_id in (select id from kits where store_id in (select public.my_store_ids())));

alter policy "dono gerencia clientes fiado da propria loja" on credit_customers
  using (store_id in (select public.my_store_ids()))
  with check (store_id in (select public.my_store_ids()));

alter policy "dono gerencia transacoes fiado da propria loja" on credit_transactions
  using (customer_id in (select cc.id from credit_customers cc where cc.store_id in (select public.my_store_ids())))
  with check (customer_id in (select cc.id from credit_customers cc where cc.store_id in (select public.my_store_ids())));

alter policy "dono modera avaliacoes da propria loja" on reviews
  using (store_id in (select public.my_store_ids()));

alter policy "dono sobe foto na propria pasta" on storage.objects
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (select id::text from stores where id in (select public.my_store_ids()))
  );

alter policy "dono atualiza foto na propria pasta" on storage.objects
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (select id::text from stores where id in (select public.my_store_ids()))
  );

alter policy "dono apaga foto na propria pasta" on storage.objects
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (select id::text from stores where id in (select public.my_store_ids()))
  );

-- Funções de segurança (security definer) que checavam "owner_id =
-- auth.uid()" na mão também precisam reconhecer membro convidado.

create or replace function public.close_cash_session(p_session_id uuid, p_declared numeric)
returns table (expected_cash numeric, cash_difference numeric, revenue_total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_cash_sales numeric := 0;
  v_all_revenue numeric := 0;
  v_reforco numeric := 0;
  v_sangria numeric := 0;
  v_expected numeric;
  v_revenue_by_payment jsonb;
begin
  select * into v_session from cash_sessions
    where id = p_session_id and status = 'aberto'
      and store_id in (select public.my_store_ids())
    for update;

  if not found then
    raise exception 'Sessão de caixa não encontrada ou já fechada';
  end if;

  select coalesce(sum(total), 0) into v_cash_sales from orders
    where store_id = v_session.store_id and payment_method = 'dinheiro'
      and created_at >= v_session.opened_at and status <> 'cancelado';

  select coalesce(sum(total), 0) into v_all_revenue from orders
    where store_id = v_session.store_id and created_at >= v_session.opened_at and status <> 'cancelado';

  select coalesce(sum(amount), 0) into v_reforco
    from cash_movements where session_id = p_session_id and type = 'reforco';
  select coalesce(sum(amount), 0) into v_sangria
    from cash_movements where session_id = p_session_id and type = 'sangria';

  v_expected := v_session.opening_amount + v_cash_sales + v_reforco - v_sangria;

  select jsonb_object_agg(payment_label, total) into v_revenue_by_payment
  from (
    select coalesce(payment_method, 'site/outro') as payment_label, sum(total) as total
    from orders
    where store_id = v_session.store_id and created_at >= v_session.opened_at and status <> 'cancelado'
    group by coalesce(payment_method, 'site/outro')
  ) t;

  update cash_sessions set
    closed_at = now(),
    closing_amount_declared = p_declared,
    expected_cash = v_expected,
    cash_difference = p_declared - v_expected,
    revenue_total = v_all_revenue,
    revenue_by_payment = coalesce(v_revenue_by_payment, '{}'::jsonb),
    status = 'fechado'
  where id = p_session_id;

  return query select v_expected, p_declared - v_expected, v_all_revenue;
end;
$$;

create or replace function public.pdv_sale(
  p_store_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text default 'Cliente balcão',
  p_customer_phone text default null
)
returns table (order_id uuid, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_product record;
  v_quantity int;
  v_unit_price numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_customer_id uuid;
begin
  if not exists (select 1 from stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  if p_payment_method not in ('dinheiro', 'pix', 'cartao', 'fiado') then
    raise exception 'Forma de pagamento inválida';
  end if;

  if p_payment_method = 'fiado' and (p_customer_phone is null or trim(p_customer_phone) = '') then
    raise exception 'Venda fiado precisa do WhatsApp do cliente';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Carrinho vazio';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::int;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida';
    end if;

    select id, name, price, stock, promo_buy_qty, promo_pay_qty,
           price_wholesale, wholesale_min_qty, price_fiado, on_offer, offer_price
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

    if p_payment_method = 'fiado' and v_product.price_fiado is not null then
      v_line_total := v_product.price_fiado * v_quantity;
      v_unit_price := v_product.price_fiado;
    elsif v_product.on_offer and v_product.offer_price is not null then
      v_line_total := v_product.offer_price * v_quantity;
      v_unit_price := v_product.offer_price;
    elsif v_product.price_wholesale is not null and v_quantity >= v_product.wholesale_min_qty then
      v_line_total := v_product.price_wholesale * v_quantity;
      v_unit_price := v_product.price_wholesale;
    elsif v_product.promo_buy_qty is not null and v_quantity >= v_product.promo_buy_qty then
      v_line_total := (
        (v_quantity / v_product.promo_buy_qty) * v_product.promo_pay_qty
        + (v_quantity % v_product.promo_buy_qty)
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
      'line_total', v_line_total
    );
  end loop;

  insert into public.orders (store_id, customer_name, customer_phone, items, total, status, channel, payment_method)
  values (
    p_store_id,
    coalesce(nullif(trim(p_customer_name), ''), 'Cliente balcão'),
    coalesce(nullif(trim(p_customer_phone), ''), 'balcão'),
    v_order_items,
    v_total,
    'entregue',
    'balcao',
    p_payment_method
  )
  returning id into v_order_id;

  if p_payment_method = 'fiado' then
    insert into public.credit_customers (store_id, name, phone)
    values (p_store_id, coalesce(nullif(trim(p_customer_name), ''), 'Cliente balcão'), trim(p_customer_phone))
    on conflict (store_id, phone) do update set name = excluded.name
    returning id into v_customer_id;

    insert into public.credit_transactions (customer_id, type, amount, note)
    values (v_customer_id, 'venda', v_total, 'Venda no balcão (PDV)');
  end if;

  return query select v_order_id, v_total;
end;
$$;

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
    and store_id in (select public.my_store_ids());

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
