import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export default async function PainelContador({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = getSupabaseAdmin();

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, slug")
    .eq("accountant_token", token)
    .maybeSingle();

  if (!store) notFound();

  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [{ data: orders }, { data: expenses }, { data: creditCustomers }] = await Promise.all([
    supabase
      .from("orders")
      .select("total, status, channel, payment_method, created_at")
      .eq("store_id", store.id)
      .neq("status", "cancelado")
      .gte("created_at", since.toISOString()),
    supabase
      .from("expenses")
      .select("amount, expense_date")
      .eq("store_id", store.id)
      .gte("expense_date", since.toISOString().slice(0, 10)),
    supabase.from("credit_customers").select("balance").eq("store_id", store.id),
  ]);

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;

  const monthlyTotals = new Map<string, { sales: number; orders: number; expenses: number; year: number; month: number }>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthlyTotals.set(`${d.getFullYear()}-${d.getMonth()}`, {
      sales: 0,
      orders: 0,
      expenses: 0,
      year: d.getFullYear(),
      month: d.getMonth(),
    });
  }

  const paymentBreakdown = new Map<string, number>();
  let currentMonthSales = 0;
  let currentMonthOrders = 0;

  for (const o of orders ?? []) {
    const created = new Date(o.created_at as string);
    const key = `${created.getFullYear()}-${created.getMonth()}`;
    const bucket = monthlyTotals.get(key);
    if (bucket) {
      bucket.sales += Number(o.total);
      bucket.orders += 1;
    }
    if (key === currentMonthKey) {
      currentMonthSales += Number(o.total);
      currentMonthOrders += 1;
      const label = o.payment_method || (o.channel === "site" ? "site (a combinar)" : o.channel);
      paymentBreakdown.set(label, (paymentBreakdown.get(label) ?? 0) + Number(o.total));
    }
  }

  let currentMonthExpenses = 0;
  for (const e of expenses ?? []) {
    const d = new Date(e.expense_date as string);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const bucket = monthlyTotals.get(key);
    if (bucket) bucket.expenses += Number(e.amount);
    if (key === currentMonthKey) currentMonthExpenses += Number(e.amount);
  }

  const creditBalance = (creditCustomers ?? []).reduce((sum, c) => sum + Number(c.balance), 0);
  const months = Array.from(monthlyTotals.values()).sort((a, b) => (a.year - b.year) || (a.month - b.month));

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-slate-50 px-4 py-8 dark:bg-slate-950">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-900 dark:text-blue-400">
          Acesso do contador · somente leitura
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">{store.name}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Esse link mostra só um resumo financeiro — não dá pra editar nada por aqui.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Vendas do mês</p>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-50">
            {formatCurrency(currentMonthSales)}
          </p>
          <p className="text-xs text-slate-400">{currentMonthOrders} pedido{currentMonthOrders === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Despesas do mês</p>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-50">
            {formatCurrency(currentMonthExpenses)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Fiado em aberto</p>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-50">
            {formatCurrency(creditBalance)}
          </p>
        </div>
      </div>

      {paymentBreakdown.size > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Vendas do mês por forma de pagamento
          </h2>
          <div className="mt-2 flex flex-col gap-1.5">
            {Array.from(paymentBreakdown.entries()).map(([label, total]) => (
              <p key={label} className="flex justify-between text-sm">
                <span className="capitalize text-slate-600 dark:text-slate-400">{label}</span>
                <span className="font-medium text-slate-900 dark:text-slate-50">{formatCurrency(total)}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Últimos 6 meses
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1 pr-3 font-normal">Mês</th>
                <th className="py-1 pr-3 font-normal">Pedidos</th>
                <th className="py-1 pr-3 font-normal">Vendas</th>
                <th className="py-1 font-normal">Despesas</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={`${m.year}-${m.month}`} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 capitalize text-slate-700 dark:text-slate-300">
                    {monthLabel(m.year, m.month)}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{m.orders}</td>
                  <td className="py-1.5 pr-3 font-medium text-slate-900 dark:text-slate-50">
                    {formatCurrency(m.sales)}
                  </td>
                  <td className="py-1.5 text-slate-600 dark:text-slate-400">{formatCurrency(m.expenses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
