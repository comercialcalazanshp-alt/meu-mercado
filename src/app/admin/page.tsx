import { getSupabaseAdmin } from "@/lib/supabase-admin";
import StoreRow from "./store-row";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{value}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
    </div>
  );
}

export default async function AdminDashboard() {
  const supabase = getSupabaseAdmin();

  const [{ data: stores }, { data: products }, { data: orders }, { data: plans }] = await Promise.all([
    supabase
      .from("stores")
      .select("id, slug, name, whatsapp, active, created_at, plan_id")
      .order("created_at", { ascending: false }),
    supabase.from("products").select("store_id"),
    supabase.from("orders").select("store_id"),
    supabase.from("plans").select("id, code, name, price_monthly").order("price_monthly"),
  ]);

  const productCounts = new Map<string, number>();
  for (const p of products ?? []) {
    productCounts.set(p.store_id, (productCounts.get(p.store_id) ?? 0) + 1);
  }
  const orderCounts = new Map<string, number>();
  for (const o of orders ?? []) {
    orderCounts.set(o.store_id, (orderCounts.get(o.store_id) ?? 0) + 1);
  }

  const activeCount = (stores ?? []).filter((s) => s.active).length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Lojas cadastradas</h1>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Lojas" value={stores?.length ?? 0} />
        <StatCard label="Ativas" value={activeCount} />
        <StatCard label="Produtos" value={products?.length ?? 0} />
        <StatCard label="Pedidos" value={orders?.length ?? 0} />
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
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
                  Nenhuma loja cadastrada ainda.
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
    </div>
  );
}
