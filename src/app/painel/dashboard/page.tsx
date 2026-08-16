"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Order = {
  id: string;
  items: { name: string; price: number; quantity: number }[];
  total: number;
  status: string;
  channel: string | null;
  payment_method: string | null;
  created_at: string;
  delivered_at: string | null;
  delivered_by: string | null;
  delivery_payout_settled: boolean;
};

type Partnership = {
  id: string;
  category: string;
  owner_name: string;
  active: boolean;
  plan_type: string;
  billing_cycle: "mensal" | "trimestral" | "semestral" | "anual";
  subscription_price: number | null;
  subscription_due_at: string | null;
  balance: number;
  commission_percent: number;
};

type SettlementTx = { partnership_id: string; type: string; amount: number; created_at: string };

type ClubSubscription = {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  monthly_amount: number;
  active: boolean;
  last_generated_at: string | null;
};

type EntregadorMember = { id: string; full_name: string | null; value_per_delivery: number | null };

type Profit = { revenue: number; cogs: number; missing_cost: boolean; expenses: number; profit: number };

type Expense = { id: string; description: string; category: string; amount: number; expense_date: string };

const CYCLE_MONTHS: Record<Partnership["billing_cycle"], number> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

const PERIODS = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes", label: "Este mês" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

function formatCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatCurrencyCompact(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function dayKey(iso: string) {
  return iso.slice(0, 10);
}
function shortDay(key: string) {
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}
function periodRange(period: PeriodKey): { since: Date; until: Date; prevSince: Date; prevUntil: Date; days: number } {
  const now = new Date();
  if (period === "hoje") {
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const until = new Date(since.getTime() + 24 * 3600 * 1000);
    const prevSince = new Date(since.getTime() - 24 * 3600 * 1000);
    return { since, until, prevSince, prevUntil: since, days: 1 };
  }
  if (period === "mes") {
    const since = new Date(now.getFullYear(), now.getMonth(), 1);
    const until = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prevSince = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { since, until, prevSince, prevUntil: since, days: since.getDate() === 1 ? 30 : 30 };
  }
  const days = period === "7d" ? 7 : 30;
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const prevSince = new Date(since.getTime() - days * 24 * 3600 * 1000);
  return { since, until: now, prevSince, prevUntil: since, days };
}

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

// ---------- small chart primitives (sem dependência externa) ----------

function Sparkline({ values, colorClass }: { values: number[]; colorClass: string }) {
  const w = 100, h = 28;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * w,
    h - ((v - min) / range) * (h - 4) - 2,
  ]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-7 w-full" preserveAspectRatio="none">
      <path d={d} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={colorClass} stroke="currentColor" />
    </svg>
  );
}

function KpiCard({
  label, value, delta, ctx, spark, colorClass, bgClass,
}: {
  label: string; value: string; delta: number | null; ctx: string; spark: number[]; colorClass: string; bgClass: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${bgClass} ${colorClass}`}>●</span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-50">{value}</div>
      <div className="mt-2 flex items-center gap-2">
        {delta !== null && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              delta >= 0
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
            }`}
          >
            {delta >= 0 ? "+" : ""}
            {delta}%
          </span>
        )}
        <span className="text-xs text-slate-400 dark:text-slate-500">{ctx}</span>
      </div>
      <Sparkline values={spark.length > 1 ? spark : [0, ...spark]} colorClass={colorClass} />
    </div>
  );
}

function StackedAreaChart({
  labels, series,
}: {
  labels: string[];
  series: { key: string; label: string; values: number[]; colorClass: string; strokeHex: string; active: boolean }[];
}) {
  const W = 1000, H = 220, pad = 6;
  const active = series.filter((s) => s.active);
  const totals = labels.map((_, i) => active.reduce((sum, s) => sum + s.values[i], 0));
  const max = Math.max(1, ...totals) * 1.15;

  let cum = labels.map(() => 0);
  const paths = active
    .slice()
    .reverse()
    .map((s) => {
      const top = labels.map((_, i) => cum[i] + s.values[i]);
      const pts = top.map((v, i) => [(i / Math.max(1, labels.length - 1)) * W, H - pad - (v / max) * (H - 2 * pad)]);
      const base = cum
        .map((v, i) => [(i / Math.max(1, labels.length - 1)) * W, H - pad - (v / max) * (H - 2 * pad)])
        .reverse();
      const area = "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L") + " L" + base.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L") + " Z";
      const line = "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L");
      cum = top;
      return { key: s.key, area, line, strokeHex: s.strokeHex };
    });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" preserveAspectRatio="none">
      {[0, 1, 2, 3].map((g) => (
        <line key={g} x1={0} y1={pad + ((H - 2 * pad) * g) / 3} x2={W} y2={pad + ((H - 2 * pad) * g) / 3} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={1} />
      ))}
      {paths.map((p) => (
        <path key={p.key} d={p.area} fill={p.strokeHex} opacity={0.14} />
      ))}
      {paths.map((p) => (
        <path key={p.key + "-line"} d={p.line} fill="none" stroke={p.strokeHex} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function Donut({ segments, size = 128 }: { segments: { pct: number; hex: string }[]; size?: number }) {
  const r = size / 2 - 12, c = 2 * Math.PI * r, cx = size / 2, cy = size / 2;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((s, i) => {
        const len = (s.pct / 100) * c;
        const el = (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.hex}
            strokeWidth={15}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

function RankRow({ rank, name, pct, value, hex }: { rank?: number; name: string; pct: number; value: string; hex: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-0 dark:border-slate-800">
      {rank !== undefined && <div className="w-5 flex-shrink-0 text-xs font-bold text-slate-400 dark:text-slate-500">{rank}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{name}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(4, pct)}%`, background: hex }} />
        </div>
      </div>
      <div className="w-24 flex-shrink-0 text-right text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  );
}

const COLOR_HEX = { accent: "#2563eb", positive: "#059669", warning: "#d97706", afil: "#7c3aed", assin: "#0d9488", entr: "#ea580c", negative: "#e11d48" };

export default function Dashboard() {
  const store = useStore();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"mercado" | "afiliados" | "assinaturas" | "entregadores">("mercado");

  const [orders, setOrders] = useState<Order[]>([]);
  const [prevOrders, setPrevOrders] = useState<Order[]>([]);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [settlements, setSettlements] = useState<SettlementTx[]>([]);
  const [prevSettlements, setPrevSettlements] = useState<SettlementTx[]>([]);
  const [clubSubs, setClubSubs] = useState<ClubSubscription[]>([]);
  const [entregadores, setEntregadores] = useState<EntregadorMember[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [profit, setProfit] = useState<Profit | null>(null);
  const [prevProfit, setPrevProfit] = useState<Profit | null>(null);

  const range = useMemo(() => periodRange(period), [period]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = getSupabase();
      const { since, until, prevSince, prevUntil } = range;

      const [ordersRes, partnershipsRes, clubRes, entregadoresRes, expensesRes, profitRes, prevProfitRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id, items, total, status, channel, payment_method, created_at, delivered_at, delivered_by, delivery_payout_settled")
          .eq("store_id", store.id)
          .gte("created_at", prevSince.toISOString())
          .lt("created_at", until.toISOString())
          .order("created_at", { ascending: true }),
        supabase
          .from("affiliate_partnerships")
          .select("id, category, owner_name, active, plan_type, billing_cycle, subscription_price, subscription_due_at, balance, commission_percent")
          .eq("hub_store_id", store.id),
        supabase
          .from("subscriptions")
          .select("id, customer_name, customer_phone, monthly_amount, active, last_generated_at")
          .eq("store_id", store.id),
        supabase.from("store_members").select("id, full_name, value_per_delivery").eq("store_id", store.id).eq("role", "entregador"),
        supabase
          .from("expenses")
          .select("id, description, category, amount, expense_date")
          .eq("store_id", store.id)
          .gte("expense_date", since.toISOString().slice(0, 10))
          .lte("expense_date", until.toISOString().slice(0, 10)),
        supabase.rpc("get_profit_summary", { p_store_id: store.id, p_since: since.toISOString(), p_until: until.toISOString() }),
        supabase.rpc("get_profit_summary", { p_store_id: store.id, p_since: prevSince.toISOString(), p_until: prevUntil.toISOString() }),
      ]);
      if (cancelled) return;

      const allOrders = (ordersRes.data ?? []) as Order[];
      setOrders(allOrders.filter((o) => new Date(o.created_at) >= since && o.status !== "cancelado"));
      setPrevOrders(allOrders.filter((o) => new Date(o.created_at) >= prevSince && new Date(o.created_at) < prevUntil && o.status !== "cancelado"));

      const partnershipList = (partnershipsRes.data ?? []) as Partnership[];
      setPartnerships(partnershipList);

      if (partnershipList.length > 0) {
        const { data: settlementData } = await supabase
          .from("affiliate_settlement_transactions")
          .select("partnership_id, type, amount, created_at")
          .in("partnership_id", partnershipList.map((p) => p.id))
          .eq("type", "venda")
          .gte("created_at", prevSince.toISOString());
        if (!cancelled) {
          const all = (settlementData ?? []) as SettlementTx[];
          setSettlements(all.filter((s) => new Date(s.created_at) >= since));
          setPrevSettlements(all.filter((s) => new Date(s.created_at) >= prevSince && new Date(s.created_at) < prevUntil));
        }
      } else {
        setSettlements([]);
        setPrevSettlements([]);
      }

      setClubSubs((clubRes.data ?? []) as ClubSubscription[]);
      setEntregadores((entregadoresRes.data ?? []) as EntregadorMember[]);
      setExpenses((expensesRes.data ?? []) as Expense[]);
      if (!profitRes.error && profitRes.data?.length) setProfit(profitRes.data[0]);
      if (!prevProfitRes.error && prevProfitRes.data?.length) setPrevProfit(prevProfitRes.data[0]);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, period]);

  // ---------- KPIs ----------
  const revenue = useMemo(() => orders.reduce((s, o) => s + o.total, 0), [orders]);
  const prevRevenue = useMemo(() => prevOrders.reduce((s, o) => s + o.total, 0), [prevOrders]);
  const ticketMedio = orders.length ? revenue / orders.length : 0;
  const prevTicketMedio = prevOrders.length ? prevRevenue / prevOrders.length : 0;

  const dailyBuckets = useMemo(() => {
    const map = new Map<string, number>();
    const d = new Date(range.since);
    while (d < range.until) {
      map.set(dayKey(d.toISOString()), 0);
      d.setDate(d.getDate() + 1);
    }
    return map;
  }, [range]);

  const mercadoSeries = useMemo(() => {
    const map = new Map(dailyBuckets);
    for (const o of orders) {
      const k = dayKey(o.created_at);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + o.total);
    }
    return Array.from(map.entries());
  }, [orders, dailyBuckets]);

  const afiliadosSeries = useMemo(() => {
    const map = new Map(dailyBuckets);
    for (const s of settlements) {
      const k = dayKey(s.created_at);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + s.amount);
    }
    return Array.from(map.entries());
  }, [settlements, dailyBuckets]);

  const [layersActive, setLayersActive] = useState({ mercado: true, afiliados: true });

  const chartLabels = mercadoSeries.map(([k]) => k);
  const chartSpark = mercadoSeries.map(([, v]) => v);

  // ---------- Mercado ----------
  const pdvTotal = orders.filter((o) => o.channel === "pdv").reduce((s, o) => s + o.total, 0);
  const siteTotal = orders.filter((o) => o.channel !== "pdv").reduce((s, o) => s + o.total, 0);
  const payWays = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      const key = o.payment_method ?? "não informado";
      map.set(key, (map.get(key) ?? 0) + o.total);
    }
    const labels: Record<string, string> = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro", fiado: "Fiado" };
    return Array.from(map.entries())
      .map(([k, v]) => ({ name: labels[k] ?? k, value: v }))
      .sort((a, b) => b.value - a.value);
  }, [orders]);

  const topProducts = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      for (const item of o.items ?? []) {
        map.set(item.name, (map.get(item.name) ?? 0) + item.price * item.quantity);
      }
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [orders]);

  // ---------- Afiliados ----------
  // "amount" numa transação 'venda' é o valor que fica devido AO AFILIADO
  // (é o que o gatilho soma em affiliate_partnerships.balance = "a
  // repassar") — não é o ganho do hub. O ganho do hub é a comissão sobre a
  // venda cheia: se amount = venda_cheia * (1 - comissao%), então
  // venda_cheia = amount / (1 - comissao%) e comissao_hub = venda_cheia - amount.
  function hubCommission(t: SettlementTx): number {
    const pct = partnerships.find((p) => p.id === t.partnership_id)?.commission_percent ?? 0;
    if (pct <= 0 || pct >= 100) return 0;
    return t.amount * (pct / (100 - pct));
  }
  const activePartnerships = partnerships.filter((p) => p.active);
  const commissionRevenue = settlements.reduce((s, t) => s + hubCommission(t), 0);
  const prevCommissionRevenue = prevSettlements.reduce((s, t) => s + hubCommission(t), 0);
  const afiliadoRanking = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of settlements) map.set(t.partnership_id, (map.get(t.partnership_id) ?? 0) + hubCommission(t));
    return Array.from(map.entries())
      .map(([id, value]) => ({ name: partnerships.find((p) => p.id === id)?.owner_name ?? "—", value }))
      .sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlements, partnerships]);

  // ---------- Assinaturas (clube de clientes + mensalidade de afiliados) ----------
  const clubActive = clubSubs.filter((c) => c.active);
  const mrrClube = clubActive.reduce((s, c) => s + c.monthly_amount, 0);
  const mrrAfiliados = activePartnerships.reduce((s, p) => s + (p.subscription_price ? p.subscription_price / CYCLE_MONTHS[p.billing_cycle] : 0), 0);
  const mrrTotal = mrrClube + mrrAfiliados;
  const upcomingAfiliadoRenewals = activePartnerships
    .filter((p) => p.subscription_due_at && new Date(p.subscription_due_at) <= new Date(Date.now() + 7 * 24 * 3600 * 1000))
    .sort((a, b) => new Date(a.subscription_due_at!).getTime() - new Date(b.subscription_due_at!).getTime());

  // ---------- Entregadores ----------
  function entregaCostFor(orderList: Order[]) {
    return entregadores.map((m) => {
      const delivered = orderList.filter((o) => o.delivered_by === m.id);
      const paidCount = delivered.filter((o) => o.delivery_payout_settled).length;
      const pendingCount = delivered.filter((o) => !o.delivery_payout_settled).length;
      const rate = m.value_per_delivery ?? 0;
      return { id: m.id, name: m.full_name ?? "—", paidCount, pendingCount, paidValue: paidCount * rate, pendingValue: pendingCount * rate, totalCount: delivered.length };
    });
  }
  const entregaEntries = useMemo(() => entregaCostFor(orders), [entregadores, orders]);
  const prevEntregaEntries = useMemo(() => entregaCostFor(prevOrders), [entregadores, prevOrders]);
  const totalPagoEntregas = entregaEntries.reduce((s, e) => s + e.paidValue, 0);
  const totalAPagarEntregas = entregaEntries.reduce((s, e) => s + e.pendingValue, 0);
  const totalEntregas = entregaEntries.reduce((s, e) => s + e.totalCount, 0);
  const custoMedioEntrega = totalEntregas ? (totalPagoEntregas + totalAPagarEntregas) / totalEntregas : 0;
  const maxEntregas = Math.max(1, ...entregaEntries.map((e) => e.totalCount));
  // custo real de entrega no período = tudo que foi incorrido (pago + a
  // pagar), não só o que já foi de fato quitado — senão uma entrega feita
  // mas ainda não paga "escaparia" do lucro líquido.
  const custoEntregadoresTotal = totalPagoEntregas + totalAPagarEntregas;
  const prevCustoEntregadoresTotal = prevEntregaEntries.reduce((s, e) => s + e.paidValue + e.pendingValue, 0);

  // ---------- Despesas cadastradas (módulo Despesas), por categoria ----------
  const despesasPorCategoria = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);
  const totalDespesas = expenses.reduce((s, e) => s + e.amount, 0);

  // ---------- P&L completo: nada fica de fora ----------
  // Faturamento = tudo que a loja realmente faturou no período: vendas do
  // mercado (PDV + vitrine) + comissão ganha com vendas de afiliados no Hub.
  // O MRR de assinaturas fica de fora dessa soma de propósito (é uma taxa
  // recorrente, não uma venda realizada no período) — aparece detalhado à
  // parte, na aba Assinaturas.
  const faturamentoTotal = revenue + commissionRevenue;
  const prevFaturamentoTotal = prevRevenue + prevCommissionRevenue;
  const custoProdutos = profit?.cogs ?? 0;
  const lucroLiquido = faturamentoTotal - custoProdutos - totalDespesas - custoEntregadoresTotal;
  const prevCustoProdutos = prevProfit?.cogs ?? 0;
  const prevLucroLiquido = prevFaturamentoTotal - prevCustoProdutos - (prevProfit?.expenses ?? 0) - prevCustoEntregadoresTotal;

  const maxRank = (arr: { value: number }[]) => Math.max(1, ...arr.map((a) => a.value));

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Visão financeira de {store.name}</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                period === p.key ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Faturamento"
              value={formatCurrency(faturamentoTotal)}
              delta={pctDelta(faturamentoTotal, prevFaturamentoTotal)}
              ctx="vs. período anterior"
              spark={chartSpark}
              colorClass="text-blue-600 dark:text-blue-400"
              bgClass="bg-blue-50 dark:bg-blue-900/30"
            />
            <KpiCard
              label="Pedidos"
              value={orders.length.toLocaleString("pt-BR")}
              delta={pctDelta(orders.length, prevOrders.length)}
              ctx="vs. período anterior"
              spark={mercadoSeries.map(([, v]) => v || 0.01)}
              colorClass="text-emerald-600 dark:text-emerald-400"
              bgClass="bg-emerald-50 dark:bg-emerald-900/30"
            />
            <KpiCard
              label="Ticket médio"
              value={formatCurrency(ticketMedio)}
              delta={pctDelta(ticketMedio, prevTicketMedio)}
              ctx="vs. período anterior"
              spark={chartSpark}
              colorClass="text-amber-600 dark:text-amber-400"
              bgClass="bg-amber-50 dark:bg-amber-900/30"
            />
            <KpiCard
              label="Lucro líquido"
              value={formatCurrency(lucroLiquido)}
              delta={pctDelta(lucroLiquido, prevLucroLiquido)}
              ctx="faturamento − custo − despesas − entregadores"
              spark={chartSpark}
              colorClass={lucroLiquido >= 0 ? "text-violet-600 dark:text-violet-400" : "text-rose-600 dark:text-rose-400"}
              bgClass={lucroLiquido >= 0 ? "bg-violet-50 dark:bg-violet-900/30" : "bg-rose-50 dark:bg-rose-900/30"}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Faturamento = Mercado ({formatCurrency(revenue)}) + comissão ganha com afiliados ({formatCurrency(commissionRevenue)}). A receita de assinaturas (MRR) não entra aqui — é recorrente, não uma venda do período — veja o total na aba Assinaturas.
          </p>
          {profit?.missing_cost && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Alguns produtos vendidos não têm preço de custo cadastrado — o custo de produtos abaixo pode estar um pouco menor que o real.
            </p>
          )}

          {/* de onde vem, pra onde vai — nada fica escondido */}
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-50">De onde vem, pra onde vai</h2>
            <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">Todo real que entrou e todo centavo de custo do período, sem esconder nada</p>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Receita</h3>
                <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm dark:border-slate-800">
                  <span className="text-slate-600 dark:text-slate-300">Vendas do Mercado (PDV + vitrine)</span>
                  <span className="font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(revenue)}</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm dark:border-slate-800">
                  <span className="text-slate-600 dark:text-slate-300">Comissão de vendas de afiliados</span>
                  <span className="font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(commissionRevenue)}</span>
                </div>
                <div className="flex items-center justify-between py-2 text-sm font-bold">
                  <span className="text-slate-900 dark:text-slate-50">= Faturamento total</span>
                  <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(faturamentoTotal)}</span>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">Custos</h3>
                <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm dark:border-slate-800">
                  <span className="text-slate-600 dark:text-slate-300">Custo dos produtos vendidos</span>
                  <span className="font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(custoProdutos)}</span>
                </div>
                <div className="border-b border-slate-100 py-2 text-sm dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">Despesas cadastradas</span>
                    <span className="font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(totalDespesas)}</span>
                  </div>
                  {despesasPorCategoria.length > 0 && (
                    <div className="mt-1.5 space-y-1 border-l-2 border-slate-100 pl-2.5 dark:border-slate-800">
                      {despesasPorCategoria.map((d) => (
                        <div key={d.name} className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
                          <span className="capitalize">{d.name}</span>
                          <span className="tabular-nums">{formatCurrencyCompact(d.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm dark:border-slate-800">
                  <span className="text-slate-600 dark:text-slate-300">Pagamento a entregadores (pago + a pagar)</span>
                  <span className="font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(custoEntregadoresTotal)}</span>
                </div>
                <div className="flex items-center justify-between py-2 text-sm font-bold">
                  <span className="text-slate-900 dark:text-slate-50">= Lucro líquido</span>
                  <span className="tabular-nums text-violet-600 dark:text-violet-400">{formatCurrency(lucroLiquido)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* gráfico consolidado */}
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-50">Faturamento por dia</h2>
                <p className="text-xs text-slate-400 dark:text-slate-500">Mercado + comissão de vendas via Hub de Afiliados</p>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setLayersActive((s) => ({ ...s, mercado: !s.mercado }))}
                  className={`flex items-center gap-1.5 text-xs font-semibold ${layersActive.mercado ? "text-slate-600 dark:text-slate-300" : "text-slate-300 dark:text-slate-600"}`}
                >
                  <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_HEX.accent }} />
                  Mercado
                </button>
                <button
                  onClick={() => setLayersActive((s) => ({ ...s, afiliados: !s.afiliados }))}
                  className={`flex items-center gap-1.5 text-xs font-semibold ${layersActive.afiliados ? "text-slate-600 dark:text-slate-300" : "text-slate-300 dark:text-slate-600"}`}
                >
                  <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_HEX.afil }} />
                  Afiliados
                </button>
              </div>
            </div>
            <StackedAreaChart
              labels={chartLabels}
              series={[
                { key: "mercado", label: "Mercado", values: mercadoSeries.map(([, v]) => v), colorClass: "", strokeHex: COLOR_HEX.accent, active: layersActive.mercado },
                { key: "afiliados", label: "Afiliados", values: afiliadosSeries.map(([, v]) => v), colorClass: "", strokeHex: COLOR_HEX.afil, active: layersActive.afiliados },
              ]}
            />
            <div className="mt-1 flex justify-between px-1 text-[10px] text-slate-400 dark:text-slate-500">
              {chartLabels
                .filter((_, i) => i % Math.max(1, Math.ceil(chartLabels.length / 8)) === 0)
                .map((k) => (
                  <span key={k}>{shortDay(k)}</span>
                ))}
            </div>
          </div>

          {/* tabs */}
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {[
              { key: "mercado", label: "Mercado", hex: COLOR_HEX.accent },
              { key: "afiliados", label: "Afiliados", hex: COLOR_HEX.afil },
              { key: "assinaturas", label: "Assinaturas", hex: COLOR_HEX.assin },
              { key: "entregadores", label: "Entregadores", hex: COLOR_HEX.entr },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as typeof tab)}
                className={`flex flex-shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold shadow-sm transition ${
                  tab === t.key
                    ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: t.hex }} />
                {t.label}
              </button>
            ))}
          </div>

          {/* ---------- painel Mercado ---------- */}
          {tab === "mercado" && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">PDV vs. vitrine online</h3>
                  <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">Participação no faturamento do período</p>
                  {revenue > 0 ? (
                    <div className="flex items-center gap-5">
                      <Donut segments={[{ pct: (pdvTotal / revenue) * 100, hex: COLOR_HEX.accent }, { pct: (siteTotal / revenue) * 100, hex: COLOR_HEX.assin }]} />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_HEX.accent }} />
                          <span className="flex-1 text-slate-500 dark:text-slate-400">PDV (balcão)</span>
                          <span className="font-bold tabular-nums">{formatCurrencyCompact(pdvTotal)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_HEX.assin }} />
                          <span className="flex-1 text-slate-500 dark:text-slate-400">Vitrine online</span>
                          <span className="font-bold tabular-nums">{formatCurrencyCompact(siteTotal)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">Sem vendas no período.</p>
                  )}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Formas de pagamento</h3>
                  <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">Participação no faturamento</p>
                  {payWays.length ? (
                    payWays.map((p, i) => (
                      <RankRow key={p.name} name={p.name} pct={(p.value / maxRank(payWays)) * 100} value={formatCurrencyCompact(p.value)} hex={[COLOR_HEX.positive, COLOR_HEX.accent, COLOR_HEX.warning, COLOR_HEX.negative][i % 4]} />
                    ))
                  ) : (
                    <p className="text-sm text-slate-400">Sem vendas no período.</p>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Produtos mais vendidos</h3>
                <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">Por faturamento no período</p>
                {topProducts.length ? (
                  topProducts.map((p, i) => (
                    <RankRow key={p.name} rank={i + 1} name={p.name} pct={(p.value / maxRank(topProducts)) * 100} value={formatCurrencyCompact(p.value)} hex={COLOR_HEX.accent} />
                  ))
                ) : (
                  <p className="text-sm text-slate-400">Sem vendas no período.</p>
                )}
              </div>
            </div>
          )}

          {/* ---------- painel Afiliados ---------- */}
          {tab === "afiliados" && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Comissão de vendas</h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500">O que o Hub ganhou com vendas de afiliados</p>
                  <div className="mt-3 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(commissionRevenue)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Afiliados ativos</h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Parcerias no Hub</p>
                  <div className="mt-3 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{activePartnerships.length}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">A repassar</h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Saldo devido aos afiliados</p>
                  <div className="mt-3 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {formatCurrency(activePartnerships.reduce((s, p) => s + Math.max(0, p.balance), 0))}
                  </div>
                </div>
              </div>
              {commissionRevenue === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  Ainda não há vendas de afiliados registradas — isso depende do checkout multi-loja, que ainda não foi construído.
                </p>
              )}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Ranking de afiliados</h3>
                <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">Por vendas geradas no período</p>
                {afiliadoRanking.length ? (
                  afiliadoRanking.map((p, i) => (
                    <RankRow key={p.name + i} rank={i + 1} name={p.name} pct={(p.value / maxRank(afiliadoRanking)) * 100} value={formatCurrencyCompact(p.value)} hex={COLOR_HEX.afil} />
                  ))
                ) : (
                  <p className="text-sm text-slate-400">Nenhuma venda de afiliado no período.</p>
                )}
              </div>
            </div>
          )}

          {/* ---------- painel Assinaturas ---------- */}
          {tab === "assinaturas" && (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Receita recorrente mensal (MRR)</h3>
                <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Clube de assinatura + mensalidade dos afiliados no Hub</p>
                <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-3 sm:grid-cols-3 dark:border-slate-800">
                  <div>
                    <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(mrrTotal)}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">MRR total</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold tabular-nums text-teal-600 dark:text-teal-400">{formatCurrency(mrrClube)}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">clube de clientes · {clubActive.length} assinantes</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold tabular-nums text-violet-600 dark:text-violet-400">{formatCurrency(mrrAfiliados)}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">mensalidade dos afiliados · {activePartnerships.filter((p) => p.subscription_price).length} planos</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Clube de clientes</h3>
                  <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">Assinantes ativos</p>
                  {clubActive.length ? (
                    clubActive.slice(0, 6).map((c) => (
                      <div key={c.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
                        <span className="text-slate-700 dark:text-slate-200">{c.customer_name || c.customer_phone}</span>
                        <span className="font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(c.monthly_amount)}/mês</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-400">Nenhum assinante ativo ainda.</p>
                  )}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Próximos vencimentos (afiliados)</h3>
                  <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">Nos próximos 7 dias</p>
                  {upcomingAfiliadoRenewals.length ? (
                    upcomingAfiliadoRenewals.map((p) => (
                      <div key={p.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
                        <span className="text-slate-700 dark:text-slate-200">{p.owner_name}</span>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          {new Date(p.subscription_due_at!).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-400">Nenhum vencimento nos próximos 7 dias.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---------- painel Entregadores ---------- */}
          {tab === "entregadores" && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Pago no período</h3>
                  <div className="mt-2 text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatCurrency(totalPagoEntregas)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">A pagar</h3>
                  <div className="mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatCurrency(totalAPagarEntregas)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Custo médio por entrega</h3>
                  <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(custoMedioEntrega)}</div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Entregas por entregador</h3>
                <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">Pago + a pagar no período</p>
                {entregaEntries.length ? (
                  entregaEntries
                    .slice()
                    .sort((a, b) => b.totalCount - a.totalCount)
                    .map((e, i) => (
                      <RankRow
                        key={e.id}
                        rank={i + 1}
                        name={e.name}
                        pct={(e.totalCount / maxEntregas) * 100}
                        value={`${e.totalCount} · ${formatCurrencyCompact(e.paidValue + e.pendingValue)}`}
                        hex={COLOR_HEX.entr}
                      />
                    ))
                ) : (
                  <p className="text-sm text-slate-400">Nenhum entregador cadastrado ainda.</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
