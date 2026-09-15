-- O PDV buscava a categoria de TODOS os produtos (paginado, 2+ consultas
-- pra loja com catálogo grande) só pra montar a lista de categorias únicas
-- do formulário de cadastro rápido — isso ficou visivelmente mais lento à
-- medida que o catálogo passou de 1000 produtos (rodou em 2,45s numa
-- medição real). Um "select distinct" direto no banco devolve só os nomes
-- de categoria (uma dúzia, não 1600+ linhas), numa consulta só.
create or replace function public.get_product_categories(p_store_id uuid)
returns table (category text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct p.category
  from products p
  where p.store_id = p_store_id
    and p.store_id in (select public.my_pdv_store_ids())
    and p.category is not null
    and p.category <> ''
  order by p.category
$$;

grant execute on function public.get_product_categories(uuid) to authenticated;
