// O banco só devolve até 1.000 linhas por consulta, mesmo sem pedir limite —
// sem buscar página por página, loja com muitas vendas perdia as mais NOVAS em
// silêncio (o painel mostrava o faturamento só até uma certa data e o lucro
// ficava negativo). Esta função busca de 1.000 em 1.000 até acabar.
//
// Use sempre com .order(...) estável (ex: created_at e depois id), senão uma
// linha pode aparecer duas vezes ou ficar de fora entre uma página e outra.
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<PageResult<T>> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return { data: all, error: null };
}
