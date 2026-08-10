"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Expense = {
  id: string;
  description: string;
  category: string;
  amount: number;
  expense_date: string;
};

const CATEGORIES = [
  { value: "fornecedores", label: "Fornecedores" },
  { value: "aluguel", label: "Aluguel" },
  { value: "energia_agua", label: "Energia/Água" },
  { value: "salarios", label: "Salários" },
  { value: "transporte", label: "Transporte" },
  { value: "outros", label: "Outros" },
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Despesas() {
  const store = useStore();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("fornecedores");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);

  async function loadExpenses() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("expenses")
      .select("id, description, category, amount, expense_date")
      .eq("store_id", store.id)
      .order("expense_date", { ascending: false });
    setExpenses(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const value = Number(amount.replace(",", "."));
    if (!description.trim() || Number.isNaN(value) || value <= 0) {
      setError("Preencha a descrição e um valor válido.");
      return;
    }

    setSaving(true);
    const { error: insertError } = await getSupabase().from("expenses").insert({
      store_id: store.id,
      description: description.trim(),
      category,
      amount: value,
      expense_date: date,
    });
    setSaving(false);

    if (insertError) {
      setError("Não deu pra salvar a despesa: " + insertError.message);
      return;
    }

    setDescription("");
    setAmount("");
    setDate(todayIso());
    loadExpenses();
  }

  async function deleteExpense(id: string) {
    if (!window.confirm("Excluir essa despesa?")) return;
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    await getSupabase().from("expenses").delete().eq("id", id);
  }

  const currentMonthExpenses = useMemo(() => {
    const now = new Date();
    return expenses.filter((e) => {
      const d = new Date(e.expense_date + "T00:00:00");
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }, [expenses]);

  const monthTotal = currentMonthExpenses.reduce((sum, e) => sum + e.amount, 0);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of currentMonthExpenses) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [currentMonthExpenses]);

  const maxCategoryValue = Math.max(1, ...byCategory.map(([, v]) => v));

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Despesas</h1>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{formatCurrency(monthTotal)}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">total de despesas neste mês</p>
      </div>

      {byCategory.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Por categoria (mês atual)
          </h2>
          <div className="mt-3 space-y-2">
            {byCategory.map(([cat, value]) => (
              <div key={cat}>
                <div className="flex justify-between text-sm text-slate-700 dark:text-slate-300">
                  <span>{CATEGORY_LABELS[cat] ?? cat}</span>
                  <span className="font-medium">{formatCurrency(value)}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-900 dark:bg-blue-700"
                    style={{ width: `${(value / maxCategoryValue) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={handleAdd}
        className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição (ex: fornecedor de bebidas)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 lg:col-span-2"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Valor (R$)"
          inputMode="decimal"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {saving ? "Salvando…" : "Registrar despesa"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-6 space-y-2">
        {loading && <p className="text-sm text-slate-500">Carregando…</p>}
        {!loading && expenses.length === 0 && (
          <p className="text-sm text-slate-500">Nenhuma despesa registrada ainda.</p>
        )}
        {expenses.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-50">{e.description}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {CATEGORY_LABELS[e.category] ?? e.category} ·{" "}
                {new Date(e.expense_date + "T00:00:00").toLocaleDateString("pt-BR")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-900 dark:text-slate-50">
                {formatCurrency(e.amount)}
              </span>
              <button
                onClick={() => deleteExpense(e.id)}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
