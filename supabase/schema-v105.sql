-- Meu Mercado — v105.
-- Cupom sem influenciador vinculado só mostrava "used_count" — sem saber
-- quanto de fato rendeu de faturamento nem quanto de desconto deu. Uma
-- versão simples do mesmo relatório de influenciador, mas pra qualquer
-- cupom.
create or replace function public.coupon_report(p_store_id uuid)
returns table (
  coupon_id uuid,
  code text,
  orders_count bigint,
  revenue_generated numeric,
  discount_given numeric,
  last_order_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.stores where id = p_store_id and id in (select public.my_store_ids())) then
    raise exception 'Loja não encontrada';
  end if;

  return query
  select
    c.id,
    c.code,
    count(o.id),
    coalesce(sum(o.total), 0),
    coalesce(sum(o.discount_amount), 0),
    max(o.created_at)
  from public.coupons c
  left join public.orders o on o.store_id = c.store_id and lower(o.coupon_code) = lower(c.code)
  where c.store_id = p_store_id
  group by c.id, c.code;
end;
$$;

grant execute on function public.coupon_report(uuid) to authenticated;
