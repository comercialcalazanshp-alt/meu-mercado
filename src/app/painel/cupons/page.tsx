"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  influencer_id: string | null;
};

type Influencer = {
  id: string;
  name: string;
  phone: string | null;
  commission_percent: number;
  notes: string | null;
  active: boolean;
};

type InfluencerReport = {
  influencer_id: string;
  name: string;
  phone: string | null;
  commission_percent: number;
  active: boolean;
  coupon_codes: string[];
  orders_count: number;
  revenue_generated: number;
  discount_given: number;
  commission_owed: number;
  total_paid: number;
  balance_due: number;
  last_order_at: string | null;
};

type InfluencerOrder = {
  order_id: string;
  customer_name: string;
  customer_phone: string;
  coupon_code: string;
  total: number;
  discount_amount: number;
  commission: number;
  created_at: string;
};

function formatDiscount(c: Coupon) {
  return c.discount_type === "percent" ? `${c.discount_value}%` : `R$ ${c.discount_value}`;
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildInfluencerSummary(store: { name: string }, r: InfluencerReport) {
  return [
    `Oi ${r.name}! Resumo do seu cupom (${r.coupon_codes.join(", ") || "sem cupom"}) na ${store.name}:`,
    `📦 ${r.orders_count} pedido(s) · 💰 ${formatCurrency(r.revenue_generated)} em vendas geradas`,
    `Sua comissão (${r.commission_percent}%): ${formatCurrency(r.commission_owed)}`,
    `Já pago: ${formatCurrency(r.total_paid)} · Saldo: ${formatCurrency(r.balance_due)}`,
  ].join("\n");
}

export default function Cupons() {
  const store = useStore();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [reports, setReports] = useState<InfluencerReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [minOrderValue, setMinOrderValue] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [influencerId, setInfluencerId] = useState("");
  const [saving, setSaving] = useState(false);

  const [infName, setInfName] = useState("");
  const [infPhone, setInfPhone] = useState("");
  const [infCommission, setInfCommission] = useState("");
  const [infNotes, setInfNotes] = useState("");
  const [infSaving, setInfSaving] = useState(false);

  const [expandedInfluencerId, setExpandedInfluencerId] = useState<string | null>(null);
  const [influencerOrders, setInfluencerOrders] = useState<Record<string, InfluencerOrder[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, { amount: string; note: string }>>({});
  const [savingPayment, setSavingPayment] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    const supabase = getSupabase();
    const [{ data: couponsData }, { data: influencersData }, { data: reportsData }] = await Promise.all([
      supabase
        .from("coupons")
        .select(
          "id, code, discount_type, discount_value, min_order_value, usage_limit, used_count, active, expires_at, influencer_id",
        )
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("influencers")
        .select("id, name, phone, commission_percent, notes, active")
        .eq("store_id", store.id)
        .order("name", { ascending: true }),
      supabase.rpc("influencer_report", { p_store_id: store.id }),
    ]);
    setCoupons(couponsData ?? []);
    setInfluencers(influencersData ?? []);
    setReports((reportsData as InfluencerReport[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const influencerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of influencers) map.set(i.id, i.name);
    return map;
  }, [influencers]);

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
      influencer_id: influencerId || null,
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
    setInfluencerId("");
    loadAll();
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

  async function handleAddInfluencer(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const percent = Number(infCommission.replace(",", "."));
    if (!infName.trim() || Number.isNaN(percent) || percent < 0 || percent > 100) {
      setError("Preencha o nome do parceiro e uma comissão válida (0 a 100%).");
      return;
    }

    setInfSaving(true);
    const { error: insertError } = await getSupabase().from("influencers").insert({
      store_id: store.id,
      name: infName.trim(),
      phone: infPhone.trim() || null,
      commission_percent: percent,
      notes: infNotes.trim() || null,
    });
    setInfSaving(false);

    if (insertError) {
      setError("Não deu pra salvar o parceiro: " + insertError.message);
      return;
    }

    setInfName("");
    setInfPhone("");
    setInfCommission("");
    setInfNotes("");
    loadAll();
  }

  async function toggleInfluencerActive(id: string, active: boolean) {
    setInfluencers((prev) => prev.map((i) => (i.id === id ? { ...i, active } : i)));
    await getSupabase().from("influencers").update({ active }).eq("id", id);
  }

  async function deleteInfluencer(id: string, name: string) {
    if (!window.confirm(`Excluir o parceiro "${name}"? Os cupons dele continuam existindo, só ficam sem parceiro vinculado.`))
      return;
    setInfluencers((prev) => prev.filter((i) => i.id !== id));
    await getSupabase().from("influencers").delete().eq("id", id);
    loadAll();
  }

  async function toggleExpanded(id: string) {
    const next = expandedInfluencerId === id ? null : id;
    setExpandedInfluencerId(next);
    if (next && !influencerOrders[id]) {
      setLoadingOrders(id);
      const { data } = await getSupabase().rpc("influencer_orders", {
        p_store_id: store.id,
        p_influencer_id: id,
      });
      setInfluencerOrders((prev) => ({ ...prev, [id]: (data as InfluencerOrder[]) ?? [] }));
      setLoadingOrders(null);
    }
  }

  function paymentDraftFor(id: string) {
    return paymentDrafts[id] ?? { amount: "", note: "" };
  }

  async function handleRegisterPayment(influencerId: string) {
    const draft = paymentDraftFor(influencerId);
    const amount = Number(draft.amount.replace(",", "."));
    if (!amount || Number.isNaN(amount) || amount <= 0) {
      window.alert("Informe um valor válido pra registrar o pagamento.");
      return;
    }
    setSavingPayment(influencerId);
    const { error: insertError } = await getSupabase().from("commission_payments").insert({
      store_id: store.id,
      influencer_id: influencerId,
      amount,
      note: draft.note.trim() || null,
    });
    setSavingPayment(null);
    if (insertError) {
      window.alert("Não deu pra registrar o pagamento: " + insertError.message);
      return;
    }
    setPaymentDrafts((prev) => ({ ...prev, [influencerId]: { amount: "", note: "" } }));
    loadAll();
  }

  function shareSummary(r: InfluencerReport) {
    const text = buildInfluencerSummary(store, r);
    const digits = r.phone?.replace(/\D/g, "");
    const url = digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Cupons e parceiros</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Cadastre um influenciador/parceiro, crie um cupom exclusivo pra ele, e acompanhe aqui quanto ele
        gerou de venda e quanto você deve pagar de comissão.
      </p>

      {/* Parceiros */}
      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Parceiros / influenciadores
      </h2>
      <form
        onSubmit={handleAddInfluencer}
        className="mt-2 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          value={infName}
          onChange={(e) => setInfName(e.target.value)}
          placeholder="Nome do parceiro"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={infPhone}
          onChange={(e) => setInfPhone(e.target.value)}
          placeholder="WhatsApp (opcional)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={infCommission}
          onChange={(e) => setInfCommission(e.target.value)}
          placeholder="% de comissão (ex: 10)"
          inputMode="decimal"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={infNotes}
          onChange={(e) => setInfNotes(e.target.value)}
          placeholder="Observação (opcional)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <button
          type="submit"
          disabled={infSaving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {infSaving ? "Salvando…" : "+ Adicionar parceiro"}
        </button>
      </form>

      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-slate-500">Carregando…</p>}
        {!loading && influencers.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum parceiro cadastrado ainda.</p>
        )}
        {reports.map((r) => {
          const isOpen = expandedInfluencerId === r.influencer_id;
          const orders = influencerOrders[r.influencer_id] ?? [];
          return (
            <div
              key={r.influencer_id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">
                    {r.name}{" "}
                    {!r.active && (
                      <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        inativo
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Comissão {r.commission_percent}%
                    {r.phone ? ` · ${r.phone}` : ""}
                    {r.coupon_codes.length > 0 ? ` · cupom ${r.coupon_codes.join(", ")}` : " · sem cupom vinculado"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleInfluencerActive(r.influencer_id, !r.active)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      r.active
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                        : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {r.active ? "Ativo" : "Inativo"}
                  </button>
                  <button
                    onClick={() => shareSummary(r)}
                    className="text-xs font-medium text-green-700 underline dark:text-green-400"
                  >
                    📱 Enviar resumo
                  </button>
                  <button
                    onClick={() => toggleExpanded(r.influencer_id)}
                    className="text-xs font-medium text-blue-900 hover:underline dark:text-blue-400"
                  >
                    {isOpen ? "Fechar" : "Detalhes"}
                  </button>
                  <button
                    onClick={() => deleteInfluencer(r.influencer_id, r.name)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Excluir
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-5 dark:border-slate-800">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Pedidos</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">{r.orders_count}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Vendas geradas</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">{formatCurrency(r.revenue_generated)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Comissão total</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">{formatCurrency(r.commission_owed)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Já pago</p>
                  <p className="font-semibold text-green-700 dark:text-green-400">{formatCurrency(r.total_paid)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Saldo a pagar</p>
                  <p className={`font-semibold ${r.balance_due > 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-50"}`}>
                    {formatCurrency(r.balance_due)}
                  </p>
                </div>
              </div>

              {isOpen && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Pedidos gerados por esse parceiro
                  </p>
                  {loadingOrders === r.influencer_id && <p className="mt-1 text-sm text-slate-500">Carregando…</p>}
                  {loadingOrders !== r.influencer_id && orders.length === 0 && (
                    <p className="mt-1 text-sm text-slate-500">Nenhum pedido com o cupom desse parceiro ainda.</p>
                  )}
                  {orders.length > 0 && (
                    <div className="mt-1 max-h-56 overflow-y-auto">
                      <table className="w-full min-w-[520px] text-left text-xs">
                        <thead className="text-slate-500 dark:text-slate-400">
                          <tr>
                            <th className="py-1 pr-2 font-medium">Data</th>
                            <th className="py-1 pr-2 font-medium">Cliente</th>
                            <th className="py-1 pr-2 font-medium">Cupom</th>
                            <th className="py-1 pr-2 font-medium">Total</th>
                            <th className="py-1 pr-2 font-medium">Comissão</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {orders.map((o) => (
                            <tr key={o.order_id}>
                              <td className="py-1 pr-2 text-slate-600 dark:text-slate-400">
                                {new Date(o.created_at).toLocaleDateString("pt-BR")}
                              </td>
                              <td className="py-1 pr-2 text-slate-700 dark:text-slate-300">{o.customer_name}</td>
                              <td className="py-1 pr-2 font-mono text-slate-600 dark:text-slate-400">{o.coupon_code}</td>
                              <td className="py-1 pr-2 text-slate-900 dark:text-slate-50">{formatCurrency(o.total)}</td>
                              <td className="py-1 pr-2 font-medium text-green-700 dark:text-green-400">
                                {formatCurrency(o.commission)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Registrar pagamento de comissão
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      value={paymentDraftFor(r.influencer_id).amount}
                      onChange={(e) =>
                        setPaymentDrafts((prev) => ({
                          ...prev,
                          [r.influencer_id]: { ...paymentDraftFor(r.influencer_id), amount: e.target.value },
                        }))
                      }
                      placeholder="Valor pago (R$)"
                      inputMode="decimal"
                      className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    />
                    <input
                      value={paymentDraftFor(r.influencer_id).note}
                      onChange={(e) =>
                        setPaymentDrafts((prev) => ({
                          ...prev,
                          [r.influencer_id]: { ...paymentDraftFor(r.influencer_id), note: e.target.value },
                        }))
                      }
                      placeholder="Observação (ex: Pix dia 10)"
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    />
                    <button
                      onClick={() => handleRegisterPayment(r.influencer_id)}
                      disabled={savingPayment === r.influencer_id}
                      className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
                    >
                      {savingPayment === r.influencer_id ? "Salvando…" : "Registrar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Cupons */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Cupons</h2>
      <form
        onSubmit={handleAdd}
        className="mt-2 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-7"
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
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <select
          value={influencerId}
          onChange={(e) => setInfluencerId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 lg:col-span-2"
        >
          <option value="">Sem parceiro vinculado</option>
          {influencers.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.commission_percent}%)
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800 lg:col-span-7"
        >
          {saving ? "Salvando…" : "Criar cupom"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Desconto</th>
              <th className="px-3 py-2 font-medium">Parceiro</th>
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
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && coupons.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  Nenhum cupom criado ainda.
                </td>
              </tr>
            )}
            {coupons.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-slate-50">{c.code}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{formatDiscount(c)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {c.influencer_id ? influencerNameById.get(c.influencer_id) ?? "—" : "—"}
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
