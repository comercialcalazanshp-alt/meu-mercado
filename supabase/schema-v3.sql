-- Meu Mercado — v3.
-- Corrige uma falha de segurança real: até aqui, a vitrine pública montava o
-- preço e o total do pedido no navegador do próprio cliente e mandava isso
-- pronto pro banco — dava pra adulterar o preço abrindo o devtools antes de
-- enviar. Também não existia baixa de estoque automática, então dois pedidos
-- ao mesmo tempo podiam vender mais do que existia.
--
-- Solução: uma função no banco (RPC) que recebe só os IDs e quantidades do
-- carrinho, busca o preço real e trava/confere/desconta o estoque tudo numa
-- transação só (atômico) — o navegador não decide mais preço nem estoque.

create or replace function public.checkout(
  p_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb
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
begin
  if p_customer_name is null or trim(p_customer_name) = '' then
    raise exception 'Nome do cliente é obrigatório';
  end if;
  if p_customer_phone is null or trim(p_customer_phone) = '' then
    raise exception 'WhatsApp do cliente é obrigatório';
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
      and active = true
    for update;

    if not found then
      raise exception 'Um dos produtos não está mais disponível';
    end if;

    if v_product.stock < v_quantity then
      raise exception 'Estoque insuficiente para "%": só tem % disponível', v_product.name, v_product.stock;
    end if;

    update public.products set stock = stock - v_quantity where id = v_product.id;

    v_total := v_total + (v_product.price * v_quantity);
    v_order_items := v_order_items || jsonb_build_object(
      'name', v_product.name,
      'price', v_product.price,
      'quantity', v_quantity
    );
  end loop;

  insert into public.orders (store_id, customer_name, customer_phone, items, total)
  values (p_store_id, trim(p_customer_name), trim(p_customer_phone), v_order_items, v_total)
  returning id into v_order_id;

  return query select v_order_id, v_total;
end;
$$;

grant execute on function public.checkout(uuid, text, text, jsonb) to anon, authenticated;

-- A tabela orders já aceita insert público (checkout sem login), mas agora
-- quem insere de fato é só a função acima — fecha o insert direto da tabela
-- pra ninguém conseguir mais mandar preço/total inventado.
drop policy if exists "qualquer um cria pedido" on orders;
