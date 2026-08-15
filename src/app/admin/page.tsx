import { getSupabaseAdmin } from "@/lib/supabase-admin";
import StoreRow from "./store-row";
import SupportRequestRow, { type SupportRequest } from "./support-request-row";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{value}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
    </div>
  );
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q: rawQ, page: rawPage } = await searchParams;
  const q = (rawQ ?? "").trim();
  const page = Math.max(1, Number(rawPage) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = getSupabaseAdmin();

  let storesQuery = supabase
    .from("stores")
    .select("id, slug, name, whatsapp, active, created_at, plan_id", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (q) {
    const escaped = q.replace(/[%_]/g, "\\$&");
    storesQuery = storesQuery.or(`name.ilike.%${escaped}%,slug.ilike.%${escaped}%,whatsapp.ilike.%${escaped}%`);
  }

  const [
    { data: stores, count: filteredCount },
    { count: totalStores },
    { count: activeCount },
    { data: plans },
    { data: supportRequests },
  ] = await Promise.all([
    storesQuery,
    supabase.from("stores").select("id", { count: "exact", head: true }),
    supabase.from("stores").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("plans").select("id, code, name, price_monthly").order("price_monthly"),
    supabase
      .from("support_requests")
      .select("id, message, status, created_at, store:stores(name, slug, whatsapp)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const storeIds = (stores ?? []).map((s) => s.id);
  const [{ data: products }, { data: orders }] = await Promise.all([
    storeIds.length > 0
      ? supabase.from("products").select("store_id").in("store_id", storeIds)
      : Promise.resolve({ data: [] as { store_id: string }[] }),
    storeIds.length > 0
      ? supabase.from("orders").select("store_id").in("store_id", storeIds)
      : Promise.resolve({ data: [] as { store_id: string }[] }),
  ]);

  const productCounts = new Map<string, number>();
  for (const p of products ?? []) {
    productCounts.set(p.store_id, (productCounts.get(p.store_id) ?? 0) + 1);
  }
  const orderCounts = new Map<string, number>();
  for (const o of orders ?? []) {
    orderCounts.set(o.store_id, (orderCounts.get(o.store_id) ?? 0) + 1);
  }

  const openSupportCount = (supportRequests ?? []).filter((r) => r.status === "aberto").length;

  const totalPages = Math.max(1, Math.ceil((filteredCount ?? 0) / PAGE_SIZE));

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin?${qs}` : "/admin";
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Painel da plataforma</h1>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Lojas" value={totalStores ?? 0} />
        <StatCard label="Ativas" value={activeCount ?? 0} />
        <StatCard label="Produtos (página atual)" value={products?.length ?? 0} />
        <StatCard label="Pedidos (página atual)" value={orders?.length ?? 0} />
      </div>

      <h2 className="mt-8 text-lg font-bold text-slate-900 dark:text-slate-50">
        Solicitações de ajuda {openSupportCount > 0 && `(${openSupportCount} aberta${openSupportCount === 1 ? "" : "s"})`}
      </h2>
      <div className="mt-3 flex flex-col gap-2">
        {(supportRequests ?? []).length === 0 && (
          <p className="text-sm text-slate-500">Nenhuma solicitação por aqui.</p>
        )}
        {(supportRequests as unknown as SupportRequest[] | null ?? []).map((r) => (
          <SupportRequestRow key={r.id} request={r} />
        ))}
      </div>

      <h2 className="mt-8 text-lg font-bold text-slate-900 dark:text-slate-50">Lojas cadastradas</h2>

      <form method="get" className="mt-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nome, slug ou WhatsApp…"
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 dark:bg-blue-800"
        >
          Buscar
        </button>
        {q && (
          <a
            href="/admin"
            className="shrink-0 self-center text-sm text-slate-500 hover:underline dark:text-slate-400"
          >
            Limpar
          </a>
        )}
      </form>

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 font-medium">Loja</th>
              <th className="px-3 py-2 font-medium">WhatsApp</th>
              <th className="px-3 py-2 font-medium">Criada em</th>
              <th className="px-3 py-2 font-medium">Produtos</th>
              <th className="px-3 py-2 font-medium">Pedidos</th>
              <th className="px-3 py-2 font-medium">Plano</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {(stores ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  {q ? `Nenhuma loja encontrada pra "${q}".` : "Nenhuma loja cadastrada ainda."}
                </td>
              </tr>
            )}
            {(stores ?? []).map((store) => (
              <StoreRow
                key={store.id}
                store={store}
                productCount={productCounts.get(store.id) ?? 0}
                orderCount={orderCounts.get(store.id) ?? 0}
                plans={plans ?? []}
              />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
          <p>
            Página {page} de {totalPages} · {filteredCount} {filteredCount === 1 ? "loja" : "lojas"}
          </p>
          <div className="flex gap-2">
            <a
              href={pageHref(Math.max(1, page - 1))}
              aria-disabled={page <= 1}
              className={`rounded-lg border border-slate-300 px-3 py-1.5 font-medium dark:border-slate-700 ${
                page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              ← Anterior
            </a>
            <a
              href={pageHref(Math.min(totalPages, page + 1))}
              aria-disabled={page >= totalPages}
              className={`rounded-lg border border-slate-300 px-3 py-1.5 font-medium dark:border-slate-700 ${
                page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              Próxima →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
