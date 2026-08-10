"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Coupon = {
  id: string;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_value: number;
  usage_limit: number | null;
  used_count: number;
  active: boolean;
  expires_at: string | null;
};

function formatDiscount(c: Coupon) {
  return c.discount_type === "percent" ? `${c.discount_value}%` : `R$ ${c.discount_value}`;
}

export default function Cupons() {
  const store = useStore();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [minOrderValue, setMinOrderValue] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadCoupons() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("coupons")
      .select(
        "id, code, discount_type, discount_value, min_order_value, usage_limit, used_count, active, expires_at",
      )
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    setCoupons(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCoupons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const value = Number(discountValue.replace(",", "."));
    if (!code.trim() || Number.isNaN(value) || value <= 0) {
      setError("Preencha o código e um valor de desconto válido.");
      return;
    }

    setSaving(true);
    const { error: insertError } = await getSupabase().from("coupons").insert({
      store_id: store.id,
      code: code.trim().toUpperCase(),
      discount_type: discountType,
      discount_value: value,
      min_order_value: minOrderValue ? Number(minOrderValue.replace(",", ".")) : 0,
      usage_limit: usageLimit ? Number(usageLimit) : null,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
    setSaving(false);

    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "Já existe um cupom com esse código."
          : "Não deu pra salvar o cupom: " + insertError.message,
      );
      return;
    }

    setCode("");
    setDiscountValue("");
    setMinOrderValue("");
    setUsageLimit("");
    setExpiresAt("");
    loadCoupons();
  }

  async function toggleActive(id: string, active: boolean) {
    setCoupons((prev) => prev.map((c) => (c.id === id ? { ...c, active } : c)));
    await getSupabase().from("coupons").update({ active }).eq("id", id);
  }

  async function deleteCoupon(id: string, code: string) {
    if (!window.confirm(`Excluir o cupom "${code}"?`)) return;
    setCoupons((prev) => prev.filter((c) => c.id !== id));
    await getSupabase().from("coupons").delete().eq("id", id);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Cupons de desconto</h1>

      <form
        onSubmit={handleAdd}
        className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-6"
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código (ex: BEMVINDO10)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 lg:col-span-2"
        />
        <select
          value={discountType}
          onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        >
          <option value="percent">% percentual</option>
          <option value="fixed">R$ fixo</option>
        </select>
        <input
          value={discountValue}
          onChange={(e) => setDiscountValue(e.target.value)}
          placeholder={discountType === "percent" ? "Ex: 10" : "Ex: 5,00"}
          inputMode="decimal"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={minOrderValue}
          onChange={(e) => setMinOrderValue(e.target.value)}
          placeholder="Pedido mínimo (opcional)"
          inputMode="decimal"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={usageLimit}
          onChange={(e) => setUsageLimit(e.target.value)}
          placeholder="Limite de usos (opcional)"
          inputMode="numeric"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 lg:col-span-2"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {saving ? "Salvando…" : "Criar cupom"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Desconto</th>
              <th className="px-3 py-2 font-medium">Pedido mínimo</th>
              <th className="px-3 py-2 font-medium">Usos</th>
              <th className="px-3 py-2 font-medium">Validade</th>
              <th className="px-3 py-2 font-medium">Ativo</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && coupons.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Nenhum cupom criado ainda.
                </td>
              </tr>
            )}
            {coupons.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-slate-50">
                  {c.code}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {formatDiscount(c)}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {c.min_order_value > 0 ? `R$ ${c.min_order_value}` : "—"}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {c.used_count}
                  {c.usage_limit ? ` / ${c.usage_limit}` : ""}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {c.expires_at ? new Date(c.expires_at).toLocaleDateString("pt-BR") : "Sem prazo"}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => toggleActive(c.id, !c.active)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      c.active
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                        : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {c.active ? "Ativo" : "Inativo"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => deleteCoupon(c.id, c.code)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
