-- Meu Mercado — v12.
-- PDV (venda presencial no balcão): o dono registra uma venda feita na hora,
-- na loja física, sem passar pela vitrine. Reaproveita a mesma trava atômica
-- de estoque do checkout() (FOR UPDATE) e, quando a forma de pagamento é
-- fiado, usa as mesmas tabelas de credit_customers/credit_transactions —
-- assim o saldo do cliente fica igual não importa se a venda fiada veio do
-- balcão ou foi lançada manualmente em /painel/fiado.

alter table orders add column if not exists channel text not null default 'site';
alter table orders add column if not exists payment_method text;

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
  v_total numeric := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_customer_id uuid;
begin
  if not exists (select 1 from stores where id = p_store_id and owner_id = auth.uid()) then
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

    select id, name, price, stock into v_product
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

    v_total := v_total + (v_product.price * v_quantity);
    v_order_items := v_order_items || jsonb_build_object(
      'name', v_product.name,
      'price', v_product.price,
      'quantity', v_quantity,
      'product_id', v_product.id
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

grant execute on function public.pdv_sale(uuid, jsonb, text, text, text) to authenticated;
