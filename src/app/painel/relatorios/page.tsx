"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type OrderItem = {
  name: string;
  price: number;
  quantity: number;
  product_id?: string;
  kit_id?: string;
};

type Order = {
  id: string;
  customer_name: string;
  customer_phone: string;
  items: OrderItem[];
  total: number;
  status: string;
  created_at: string;
};

type Product = {
  id: string;
  name: string;
  price: number;
  stock: number;
};

type StoreReview = {
  id: string;
  customer_name: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function toCsvValue(value: string) {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const CHANNEL_LABEL: Record<string, string> = { site: "Site", pdv: "Balcão (PDV)" };
const PAYMENT_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao: "Cartão",
  fiado: "Fiado",
};

function shortDay(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

const DAYS_FOR_CHART = 14;
const DAYS_FOR_STALE = 60;
const RANGE_DAYS = 90;

export default function Relatorios() {
  const store = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [storeReviews, setStoreReviews] = useState<StoreReview[]>([]);
  const [loading, setLoading] = useState(true);

  const [goal, setGoal] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
  const [currentGoal, setCurrentGoal] = useState(0);

  const [exportMonth, setExportMonth] = useState(currentMonthValue());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = getSupabase();
      const since = new Date();
      since.setDate(since.getDate() - RANGE_DAYS);

      const [{ data: ordersData }, { data: productsData }, { data: storeData }, { data: reviewsData }] =
        await Promise.all([
          supabase
            .from("orders")
            .select("id, customer_name, customer_phone, items, total, status, created_at")
            .eq("store_id", store.id)
            .gte("created_at", since.toISOString())
            .order("created_at", { ascending: true }),
          supabase
            .from("products")
            .select("id, name, price, stock")
            .eq("store_id", store.id)
            .eq("active", true),
          supabase.from("stores").select("sales_goal").eq("id", store.id).single(),
          supabase
            .from("store_reviews")
            .select("id, customer_name, rating, comment, created_at")
            .eq("store_id", store.id)
            .order("created_at", { ascending: false }),
        ]);

      setOrders(ordersData ?? []);
      setProducts(productsData ?? []);
      setStoreReviews(reviewsData ?? []);
      const goalValue = storeData?.sales_goal ?? 0;
      setCurrentGoal(goalValue);
      setGoal(goalValue > 0 ? String(goalValue) : "");
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const validOrders = useMemo(() => orders.filter((o) => o.status !== "cancelado"), [orders]);

  const salesByDay = useMemo(() => {
    const map = new Map<string, number>();
    const today = new Date();
    for (let i = DAYS_FOR_CHART - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      map.set(d.toISOString().slice(0, 10), 0);
    }
    for (const order of validOrders) {
      const key = dayKey(order.created_at);
      if (map.has(key)) map.set(key, (map.get(key) ?? 0) + order.total);
    }
    return Array.from(map.entries());
  }, [validOrders]);

  const maxDaySale = Math.max(1, ...salesByDay.map(([, v]) => v));

  const clientRanking = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const order of validOrders) {
      const cur = map.get(order.customer_phone) ?? { name: order.customer_name, total: 0, count: 0 };
      cur.total += order.total;
      cur.count += 1;
      cur.name = order.customer_name;
      map.set(order.customer_phone, cur);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10);
  }, [validOrders]);

  const staleProducts = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAYS_FOR_STALE);
    const seenIds = new Set<string>();
    for (const order of validOrders) {
      if (new Date(order.created_at) < cutoff) continue;
      for (const item of order.items) {
        if (item.product_id) seenIds.add(item.product_id);
      }
    }
    return products.filter((p) => !seenIds.has(p.id));
  }, [validOrders, products]);

  const currentMonthTotal = useMemo(() => {
    const now = new Date();
    return validOrders
      .filter((o) => {
        const d = new Date(o.created_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((sum, o) => sum + o.total, 0);
  }, [validOrders]);

  async function handleSaveGoal() {
    const value = Number(goal.replace(",", "."));
    if (Number.isNaN(value) || value < 0) return;
    setSavingGoal(true);
    await getSupabase().from("stores").update({ sales_goal: value }).eq("id", store.id);
    setCurrentGoal(value);
    setSavingGoal(false);
  }

  const goalProgress = currentGoal > 0 ? Math.min(100, (currentMonthTotal / currentGoal) * 100) : 0;

  const storeRatingAvg =
    storeReviews.length > 0
      ? storeReviews.reduce((sum, r) => sum + r.rating, 0) / storeReviews.length
      : 0;

  async function handleDeleteReview(id: string) {
    if (!window.confirm("Excluir essa avaliação?")) return;
    setStoreReviews((prev) => prev.filter((r) => r.id !== id));
    await getSupabase().from("store_reviews").delete().eq("id", id);
  }

  async function handleExportCsv() {
    setExportError(null);
    const [year, month] = exportMonth.split("-").map(Number);
    if (!year || !month) return;
    const since = new Date(year, month - 1, 1);
    const until = new Date(year, month, 1);

    setExporting(true);
    const { data, error } = await getSupabase()
      .from("orders")
      .select(
        "customer_name, customer_phone, items, total, status, created_at, coupon_code, discount_amount, neighborhood_name, delivery_fee, cashback_used, channel, payment_method",
      )
      .eq("store_id", store.id)
      .gte("created_at", since.toISOString())
      .lt("created_at", until.toISOString())
      .order("created_at", { ascending: true });
    setExporting(false);

    if (error) {
      setExportError("Não deu pra gerar o arquivo: " + error.message);
      return;
    }
    if (!data || data.length === 0) {
      setExportError("Nenhuma venda nesse mês.");
      return;
    }

    const header = [
      "Data",
      "Hora",
      "Cliente",
      "Telefone",
      "Canal",
      "Forma de pagamento",
      "Itens",
      "Cupom",
      "Desconto",
      "Bairro",
      "Frete",
      "Cashback usado",
      "Total",
      "Status",
    ];

    const rows = data.map((o) => {
      const created = new Date(o.created_at);
      const itemsSummary = (o.items as { name: string; quantity: number }[])
        .map((item) => `${item.quantity}x ${item.name}`)
        .join("; ");
      return [
        created.toLocaleDateString("pt-BR"),
        created.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        o.customer_name,
        o.customer_phone,
        CHANNEL_LABEL[o.channel as string] ?? o.channel,
        o.payment_method ? (PAYMENT_LABEL[o.payment_method] ?? o.payment_method) : "",
        itemsSummary,
        o.coupon_code ?? "",
        o.discount_amount.toFixed(2).replace(".", ","),
        o.neighborhood_name ?? "",
        o.delivery_fee.toFixed(2).replace(".", ","),
        o.cashback_used.toFixed(2).replace(".", ","),
        o.total.toFixed(2).replace(".", ","),
        o.status,
      ].map((v) => toCsvValue(String(v)));
    });

    const lines = [header.map(toCsvValue).join(","), ...rows.map((r) => r.join(","))];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vendas-${store.slug}-${exportMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Relatórios</h1>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Exportar vendas pro contador
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Gera uma planilha (CSV) com todas as vendas do mês escolhido, do site e do balcão, pra
          você mandar pro seu contador.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={exportMonth}
            onChange={(e) => setExportMonth(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {exporting ? "Gerando…" : "Baixar CSV"}
          </button>
        </div>
        {exportError && <p className="mt-2 text-sm text-red-600">{exportError}</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Meta de vendas do mês
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Meta (R$)"
            inputMode="decimal"
            className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          <button
            onClick={handleSaveGoal}
            disabled={savingGoal}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
          >
            {savingGoal ? "Salvando…" : "Salvar meta"}
          </button>
        </div>
        {currentGoal > 0 && (
          <div className="mt-3">
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-900 dark:bg-blue-700"
                style={{ width: `${goalProgress}%` }}
              />
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {formatCurrency(currentMonthTotal)} de {formatCurrency(currentGoal)} ({goalProgress.toFixed(0)}%)
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Vendas dos últimos {DAYS_FOR_CHART} dias
        </h2>
        <div className="mt-4 flex items-end gap-1" style={{ height: 120 }}>
          {salesByDay.map(([date, value]) => (
            <div key={date} className="flex flex-1 flex-col items-center gap-1">
              <div
                title={formatCurrency(value)}
                className="w-full rounded-t bg-blue-900 dark:bg-blue-700"
                style={{ height: `${Math.max(2, (value / maxDaySale) * 100)}px` }}
              />
              <span className="text-[10px] text-slate-400 dark:text-slate-500">{shortDay(date)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Clientes que mais compraram
        </h2>
        {clientRanking.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">Nenhum pedido nos últimos {RANGE_DAYS} dias.</p>
        )}
        <ul className="mt-2 space-y-2">
          {clientRanking.map(([phone, data], i) => (
            <li key={phone} className="flex items-center justify-between text-sm">
              <span className="text-slate-700 dark:text-slate-300">
                {i + 1}. {data.name} · {data.count} {data.count === 1 ? "pedido" : "pedidos"}
              </span>
              <span className="font-medium text-slate-900 dark:text-slate-50">
                {formatCurrency(data.total)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Produtos parados (sem venda há {DAYS_FOR_STALE}+ dias)
        </h2>
        {staleProducts.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">Nenhum — todos os produtos ativos venderam recentemente.</p>
        )}
        <ul className="mt-2 space-y-1">
          {staleProducts.map((p) => (
            <li key={p.id} className="flex justify-between text-sm text-slate-700 dark:text-slate-300">
              <span>{p.name}</span>
              <span className="text-slate-400 dark:text-slate-500">estoque: {p.stock}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Avaliações da loja
          </h2>
          {storeReviews.length > 0 && (
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              {"★".repeat(Math.round(storeRatingAvg))}
              {"☆".repeat(5 - Math.round(storeRatingAvg))} {storeRatingAvg.toFixed(1)}
            </span>
          )}
        </div>
        {storeReviews.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">Nenhuma avaliação ainda.</p>
        )}
        <ul className="mt-2 space-y-2">
          {storeReviews.map((r) => (
            <li key={r.id} className="border-t border-slate-100 pt-2 text-sm first:border-0 first:pt-0 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="font-medium text-amber-500">
                  {"★".repeat(r.rating)}
                  {"☆".repeat(5 - r.rating)}{" "}
                  <span className="font-normal text-slate-700 dark:text-slate-300">
                    {r.customer_name}
                  </span>
                </span>
                <button
                  onClick={() => handleDeleteReview(r.id)}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Excluir
                </button>
              </div>
              {r.comment && (
                <p className="text-slate-500 dark:text-slate-400">{r.comment}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
