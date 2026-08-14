-- Permite o cliente logado ver o próprio histórico de pedidos e o saldo de
-- cashback direto no site, sem precisar de uma política de RLS ampla na
-- tabela orders (que teria uma superfície maior de acesso). Segue o mesmo
-- padrão de get_order_receipt: função com SECURITY DEFINER que só devolve
-- dados do cliente autenticado.
create or replace function public.get_customer_orders(p_store_id uuid)
returns table (
  id uuid,
  items jsonb,
  total numeric,
  status text,
  created_at timestamptz,
  cashback_earned numeric,
  cashback_used numeric,
  payment_method text,
  neighborhood_name text,
  delivery_address text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select c.id into v_customer_id
  from public.customers c
  where c.store_id = p_store_id and c.profile_id = auth.uid();

  if v_customer_id is null then
    return;
  end if;

  return query
  select o.id, o.items, o.total, o.status, o.created_at,
         o.cashback_earned, o.cashback_used, o.payment_method,
         o.neighborhood_name, o.delivery_address
  from public.orders o
  where o.customer_id = v_customer_id
  order by o.created_at desc
  limit 50;
end;
$$;
