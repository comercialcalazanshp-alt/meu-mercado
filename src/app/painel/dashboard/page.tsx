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
function periodRange(period: PeriodKey): { since: Date; until: Date; prevSince: Date; prevUntil: Date } {
  const now = new Date();
  if (period === "hoje") {
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const until = new Date(since.getTime() + 24 * 3600 * 1000);
    const prevSince = new Date(since.getTime() - 24 * 3600 * 1000);
    return { since, until, prevSince, prevUntil: since };
  }
  if (period === "mes") {
    const since = new Date(now.getFullYear(), now.getMonth(), 1);
    const until = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prevSince = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { since, until, prevSince, prevUntil: since };
  }
  const days = period === "7d" ? 7 : 30;
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const prevSince = new Date(since.getTime() - days * 24 * 3600 * 1000);
  return { since, until: now, prevSince, prevUntil: since };
}

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

// ---------- small chart primitives (sem dependência externa) ----------

function Sparkline({ values, hex }: { values: number[]; hex: string }) {
  const w = 100,
    h = 28;
  const min = Math.min(...values),
    max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, h - ((v - min) / range) * (h - 4) - 2]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-7 w-full" preserveAspectRatio="none">
      <path
        d={d}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        stroke={hex}
        className="animate-mm-draw-line"
        style={{ filter: `drop-shadow(0 0 4px ${hex}99)` }}
      />
    </svg>
  );
}

function KpiCard({
  label,
  value,
  delta,
  ctx,
  spark,
  hex,
  delay,
}: {
  label: string;
  value: string;
  delta: number | null;
  ctx: string;
  spark: number[];
  hex: string;
  delay: number;
}) {
  return (
    <div
      className="animate-mm-fade-up rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-white/35">{label}</span>
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[10px]"
          style={{ background: `${hex}22`, color: hex }}
        >
          ●
        </span>
      </div>
      <div className="mt-2 text-[21px] font-extrabold tracking-tight text-[#F5F3EF] tabular-nums">{value}</div>
      <div className="mt-2 flex items-center gap-2">
        {delta !== null && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-bold"
            style={
              delta >= 0
                ? { background: "rgba(52,232,140,0.12)", color: "#34E88C" }
                : { background: "rgba(255,92,104,0.12)", color: "#FF5C68" }
            }
          >
            {delta >= 0 ? "+" : ""}
            {delta}%
          </span>
        )}
        <span className="text-[11px] text-white/30">{ctx}</span>
      </div>
      <Sparkline values={spark.length > 1 ? spark : [0, ...spark]} hex={hex} />
    </div>
  );
}

function StackedAreaChart({
  labels,
  series,
}: {
  labels: string[];
  series: { key: string; label: string; values: number[]; hex: string; active: boolean }[];
}) {
  const W = 1000,
    H = 220,
    pad = 6;
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
      const base = cum.map((v, i) => [(i / Math.max(1, labels.length - 1)) * W, H - pad - (v / max) * (H - 2 * pad)]).reverse();
      const area =
        "M" +
        pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L") +
        " L" +
        base.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L") +
        " Z";
      const line = "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L");
      cum = top;
      return { key: s.key, area, line, hex: s.hex };
    });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" preserveAspectRatio="none">
      {[0, 1, 2, 3].map((g) => (
        <line key={g} x1={0} y1={pad + ((H - 2 * pad) * g) / 3} x2={W} y2={pad + ((H - 2 * pad) * g) / 3} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      ))}
      {paths.map((p, i) => (
        <path key={p.key} d={p.area} fill={p.hex} opacity={0.16} className="animate-mm-fade-in" style={{ animationDelay: `${400 + i * 150}ms` }} />
      ))}
      {paths.map((p, i) => (
        <path
          key={p.key + "-line"}
          d={p.line}
          fill="none"
          stroke={p.hex}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-mm-draw-line"
          style={{ animationDelay: `${i * 150}ms`, filter: `drop-shadow(0 0 5px ${p.hex}80)` }}
        />
      ))}
    </svg>
  );
}

function Donut({ segments, size = 128 }: { segments: { pct: number; hex: string }[]; size?: number }) {
  const r = size / 2 - 12,
    c = 2 * Math.PI * r,
    cx = size / 2,
    cy = size / 2;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={15} />
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
            strokeLinecap="round"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            className="animate-mm-fade-in"
            style={{ animationDelay: `${300 + i * 200}ms`, filter: `drop-shadow(0 0 4px ${s.hex}80)` }}
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
    <div className="flex items-center gap-3 border-b border-white/[0.06] py-2.5 last:border-0">
      {rank !== undefined && <div className="w-5 flex-shrink-0 text-xs font-bold text-white/30">{rank}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white/85">{name}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="animate-mm-grow-w h-full rounded-full"
            style={{ "--w": `${Math.max(4, pct)}%`, background: hex, boxShadow: `0 0 6px ${hex}80` } as React.CSSProperties}
          />
        </div>
      </div>
      <div className="w-24 flex-shrink-0 text-right text-sm font-bold tabular-nums text-white/75">{value}</div>
    </div>
  );
}

const COLOR_HEX = {
  accent: "#5CACFF",
  positive: "#34E88C",
  warning: "#F0BB5E",
  afil: "#B37FE8",
  assin: "#34D9C4",
  entr: "#FF9F5C",
  negative: "#FF5C68",
};

function Card({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <div
      className={`animate-mm-fade-up rounded-2xl border border-white/[0.09] bg-white/[0.035] p-5 backdrop-blur-xl ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export default function Dashboard() {
  const store = useStore();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"mercado" | "afiliados" | "assinaturas" | "entregadores">("mercado");
  // A aba/série "Afiliados" (comissão ganha de parceiros) só faz sentido pra
  // quem é Hub — pra um afiliado comum ela ficaria sempre zerada e sem
  // sentido, então essa tela vira "vendas da loja dele" nesse caso.
  const [isHub, setIsHub] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [prevOrders, setPrevOrders] = useState<Order[]>([]);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [settlements, setSettlements] = useState<SettlementTx[]>([]);
  const [prevSettlements, setPrevSettlements] = useState<SettlementTx[]>([]);
  const [clubSubs, setClubSubs] = useState<ClubSubscription[]>([]);
  const [entregadores, setEntregadores] = useState<EntregadorMember[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [prevExpenses, setPrevExpenses] = useState<Expense[]>([]);
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
          .gte("expense_date", prevSince.toISOString().slice(0, 10))
          .lt("expense_date", until.toISOString().slice(0, 10)),
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
      {
        // expense_date é uma coluna "date" pura (sem hora) — comparar como
        // string YYYY-MM-DD evita qualquer confusão de fuso horário que um
        // "new Date(expense_date)" poderia introduzir. sinceKey/untilKey
        // usam o MESMO recorte que a query já aplicou, só pra separar o
        // resultado único em período atual vs anterior.
        const allExpenses = (expensesRes.data ?? []) as Expense[];
        const sinceKey = since.toISOString().slice(0, 10);
        setExpenses(allExpenses.filter((e) => e.expense_date >= sinceKey));
        setPrevExpenses(allExpenses.filter((e) => e.expense_date < sinceKey));
      }
      if (!profitRes.error && profitRes.data?.length) setProfit(profitRes.data[0]);
      if (!prevProfitRes.error && prevProfitRes.data?.length) setPrevProfit(prevProfitRes.data[0]);

      const { data: hubRow } = await supabase
        .from("affiliate_settings")
        .select("id")
        .eq("hub_store_id", store.id)
        .maybeSingle();
      if (!cancelled) setIsHub(!!hubRow);

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

  const ordersCountSeries = useMemo(() => {
    const map = new Map(dailyBuckets);
    for (const o of orders) {
      const k = dayKey(o.created_at);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
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
    const labels: Record<string, string> = {
      pix: "Pix",
      cartao: "Cartão",
      cartao_entrega: "Cartão na entrega",
      cartao_credito: "Cartão de crédito online",
      cartao_debito: "Cartão de débito online",
      dinheiro: "Dinheiro",
      fiado: "Fiado",
    };
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
  const prevTotalDespesas = prevExpenses.reduce((s, e) => s + e.amount, 0);

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
  // Usa prevTotalDespesas (mesma query client-side, mesmo corte de data que
  // o período atual) em vez de prevProfit.expenses — a RPC get_profit_summary
  // corta despesas com "expense_date < until::date" (exclui o dia de
  // "until"), enquanto aqui já se soma dia inteiro incluído; misturar as
  // duas fontes faria o período atual e o anterior usarem regras de data
  // diferentes pro mesmo tipo de número, distorcendo o "vs. período anterior".
  const prevLucroLiquido = prevFaturamentoTotal - prevCustoProdutos - prevTotalDespesas - prevCustoEntregadoresTotal;

  const maxRank = (arr: { value: number }[]) => Math.max(1, ...arr.map((a) => a.value));

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-black">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -top-44 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-40 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(92,172,255,0.20), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-36 top-96 h-[420px] w-[420px] rounded-full opacity-35 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(179,127,232,0.16), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-36 -bottom-16 h-[380px] w-[380px] rounded-full opacity-25 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(52,232,140,0.14), transparent 65%)" }}
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-6 text-[#F5F3EF] sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold">Dashboard</h1>
            <p className="text-[13px] text-white/35">Visão financeira de {store.name}</p>
          </div>
          <div className="flex gap-1 rounded-xl border border-white/[0.09] bg-white/[0.035] p-1 backdrop-blur-xl">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  period === p.key ? "bg-[#5CACFF] text-[#0A1A2E]" : "text-white/45 hover:bg-white/[0.06]"
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
              <div key={i} className="h-32 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
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
                hex={COLOR_HEX.accent}
                delay={0}
              />
              <KpiCard
                label="Pedidos"
                value={orders.length.toLocaleString("pt-BR")}
                delta={pctDelta(orders.length, prevOrders.length)}
                ctx="vs. período anterior"
                spark={ordersCountSeries.map(([, v]) => v || 0.01)}
                hex={COLOR_HEX.positive}
                delay={80}
              />
              <KpiCard
                label="Ticket médio"
                value={formatCurrency(ticketMedio)}
                delta={pctDelta(ticketMedio, prevTicketMedio)}
                ctx="vs. período anterior"
                spark={chartSpark}
                hex={COLOR_HEX.warning}
                delay={160}
              />
              <KpiCard
                label="Lucro líquido"
                value={formatCurrency(lucroLiquido)}
                delta={pctDelta(lucroLiquido, prevLucroLiquido)}
                ctx="faturamento − custo − despesas − entregadores"
                spark={chartSpark}
                hex={lucroLiquido >= 0 ? COLOR_HEX.afil : COLOR_HEX.negative}
                delay={240}
              />
            </div>
            <p className="mt-2 text-[11.5px] text-white/25">
              {isHub
                ? `Faturamento = Mercado (${formatCurrency(revenue)}) + comissão ganha com afiliados (${formatCurrency(commissionRevenue)}). `
                : ""}
              A receita de assinaturas (MRR) não entra aqui — é recorrente, não uma venda do período — veja o total na aba Assinaturas.
            </p>
            {profit?.missing_cost && (
              <p className="mt-1 text-[11.5px] text-[#F0BB5E]/80">
                Alguns produtos vendidos não têm preço de custo cadastrado — o custo de produtos abaixo pode estar um pouco menor que o real.
              </p>
            )}

            {/* de onde vem, pra onde vai — nada fica escondido */}
            <Card className="mt-4" delay={320}>
              <h2 className="text-[13px] font-bold">De onde vem, pra onde vai</h2>
              <p className="mb-4 text-[11.5px] text-white/30">Todo real que entrou e todo centavo de custo do período, sem esconder nada</p>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: COLOR_HEX.positive }}>
                    Receita
                  </h3>
                  <div className="flex items-center justify-between border-b border-white/[0.06] py-2 text-sm">
                    <span className="text-white/55">Vendas do Mercado (PDV + vitrine)</span>
                    <span className="font-bold tabular-nums">{formatCurrency(revenue)}</span>
                  </div>
                  {isHub && (
                    <div className="flex items-center justify-between border-b border-white/[0.06] py-2 text-sm">
                      <span className="text-white/55">Comissão de vendas de afiliados</span>
                      <span className="font-bold tabular-nums">{formatCurrency(commissionRevenue)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-2 text-sm font-bold">
                    <span>= Faturamento total</span>
                    <span className="tabular-nums" style={{ color: COLOR_HEX.positive }}>
                      {formatCurrency(faturamentoTotal)}
                    </span>
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: COLOR_HEX.negative }}>
                    Custos
                  </h3>
                  <div className="flex items-center justify-between border-b border-white/[0.06] py-2 text-sm">
                    <span className="text-white/55">Custo dos produtos vendidos</span>
                    <span className="font-bold tabular-nums">{formatCurrency(custoProdutos)}</span>
                  </div>
                  <div className="border-b border-white/[0.06] py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-white/55">Despesas cadastradas</span>
                      <span className="font-bold tabular-nums">{formatCurrency(totalDespesas)}</span>
                    </div>
                    {despesasPorCategoria.length > 0 && (
                      <div className="mt-1.5 space-y-1 border-l-2 border-white/[0.08] pl-2.5">
                        {despesasPorCategoria.map((d) => (
                          <div key={d.name} className="flex items-center justify-between text-xs text-white/30">
                            <span className="capitalize">{d.name}</span>
                            <span className="tabular-nums">{formatCurrencyCompact(d.value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-b border-white/[0.06] py-2 text-sm">
                    <span className="text-white/55">Pagamento a entregadores (pago + a pagar)</span>
                    <span className="font-bold tabular-nums">{formatCurrency(custoEntregadoresTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 text-sm font-bold">
                    <span>= Lucro líquido</span>
                    <span className="tabular-nums" style={{ color: COLOR_HEX.afil }}>
                      {formatCurrency(lucroLiquido)}
                    </span>
                  </div>
                </div>
              </div>
            </Card>

            {/* gráfico consolidado */}
            <Card className="mt-4" delay={380}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-bold">Faturamento por dia</h2>
                  <p className="text-[11.5px] text-white/30">
                    {isHub ? "Mercado + comissão de vendas via Hub de Afiliados" : "Vendas da loja"}
                  </p>
                </div>
                {isHub && (
                  <div className="flex gap-4">
                    <button
                      onClick={() => setLayersActive((s) => ({ ...s, mercado: !s.mercado }))}
                      className="flex items-center gap-1.5 text-xs font-semibold"
                      style={{ color: layersActive.mercado ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)" }}
                    >
                      <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_HEX.accent }} />
                      Mercado
                    </button>
                    <button
                      onClick={() => setLayersActive((s) => ({ ...s, afiliados: !s.afiliados }))}
                      className="flex items-center gap-1.5 text-xs font-semibold"
                      style={{ color: layersActive.afiliados ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)" }}
                    >
                      <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_HEX.afil }} />
                      Afiliados
                    </button>
                  </div>
                )}
              </div>
              <StackedAreaChart
                labels={chartLabels}
                series={
                  isHub
                    ? [
                        { key: "mercado", label: "Mercado", values: mercadoSeries.map(([, v]) => v), hex: COLOR_HEX.accent, active: layersActive.mercado },
                        { key: "afiliados", label: "Afiliados", values: afiliadosSeries.map(([, v]) => v), hex: COLOR_HEX.afil, active: layersActive.afiliados },
                      ]
                    : [{ key: "mercado", label: "Vendas", values: mercadoSeries.map(([, v]) => v), hex: COLOR_HEX.accent, active: true }]
                }
              />
              <div className="mt-1 flex justify-between px-1 text-[10px] text-white/25">
                {chartLabels
                  .filter((_, i) => i % Math.max(1, Math.ceil(chartLabels.length / 8)) === 0)
                  .map((k) => (
                    <span key={k}>{shortDay(k)}</span>
                  ))}
              </div>
            </Card>

            {/* tabs */}
            <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
              {[
                { key: "mercado", label: "Mercado", hex: COLOR_HEX.accent },
                ...(isHub ? [{ key: "afiliados", label: "Afiliados", hex: COLOR_HEX.afil }] : []),
                { key: "assinaturas", label: "Assinaturas", hex: COLOR_HEX.assin },
                { key: "entregadores", label: "Entregadores", hex: COLOR_HEX.entr },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as typeof tab)}
                  className={`flex flex-shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                    tab === t.key ? "border-white bg-white text-black" : "border-white/[0.09] bg-white/[0.035] text-white/45 hover:border-white/20"
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
                  <Card>
                    <h3 className="text-sm font-bold">PDV vs. vitrine online</h3>
                    <p className="mb-4 text-[11.5px] text-white/30">Participação no faturamento do período</p>
                    {revenue > 0 ? (
                      <div className="flex items-center gap-5">
                        <Donut segments={[{ pct: (pdvTotal / revenue) * 100, hex: COLOR_HEX.accent }, { pct: (siteTotal / revenue) * 100, hex: COLOR_HEX.assin }]} />
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_HEX.accent }} />
                            <span className="flex-1 text-white/50">PDV (balcão)</span>
                            <span className="font-bold tabular-nums">{formatCurrencyCompact(pdvTotal)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_HEX.assin }} />
                            <span className="flex-1 text-white/50">Vitrine online</span>
                            <span className="font-bold tabular-nums">{formatCurrencyCompact(siteTotal)}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-white/25">Sem vendas no período.</p>
                    )}
                  </Card>
                  <Card>
                    <h3 className="text-sm font-bold">Formas de pagamento</h3>
                    <p className="mb-2 text-[11.5px] text-white/30">Participação no faturamento</p>
                    {payWays.length ? (
                      payWays.map((p, i) => (
                        <RankRow
                          key={p.name}
                          name={p.name}
                          pct={(p.value / maxRank(payWays)) * 100}
                          value={formatCurrencyCompact(p.value)}
                          hex={[COLOR_HEX.positive, COLOR_HEX.accent, COLOR_HEX.warning, COLOR_HEX.negative][i % 4]}
                        />
                      ))
                    ) : (
                      <p className="text-sm text-white/25">Sem vendas no período.</p>
                    )}
                  </Card>
                </div>
                <Card>
                  <h3 className="text-sm font-bold">Produtos mais vendidos</h3>
                  <p className="mb-2 text-[11.5px] text-white/30">Por faturamento no período</p>
                  {topProducts.length ? (
                    topProducts.map((p, i) => (
                      <RankRow key={p.name} rank={i + 1} name={p.name} pct={(p.value / maxRank(topProducts)) * 100} value={formatCurrencyCompact(p.value)} hex={COLOR_HEX.accent} />
                    ))
                  ) : (
                    <p className="text-sm text-white/25">Sem vendas no período.</p>
                  )}
                </Card>
              </div>
            )}

            {/* ---------- painel Afiliados ---------- */}
            {tab === "afiliados" && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Card>
                    <h3 className="text-sm font-bold">Comissão de vendas</h3>
                    <p className="text-[11.5px] text-white/30">O que o Hub ganhou com vendas de afiliados</p>
                    <div className="mt-3 text-2xl font-bold tabular-nums" style={{ color: COLOR_HEX.positive }}>
                      {formatCurrency(commissionRevenue)}
                    </div>
                  </Card>
                  <Card>
                    <h3 className="text-sm font-bold">Afiliados ativos</h3>
                    <p className="text-[11.5px] text-white/30">Parcerias no Hub</p>
                    <div className="mt-3 text-2xl font-bold tabular-nums">{activePartnerships.length}</div>
                  </Card>
                  <Card>
                    <h3 className="text-sm font-bold">A repassar</h3>
                    <p className="text-[11.5px] text-white/30">Saldo devido aos afiliados</p>
                    <div className="mt-3 text-2xl font-bold tabular-nums" style={{ color: COLOR_HEX.warning }}>
                      {formatCurrency(activePartnerships.reduce((s, p) => s + Math.max(0, p.balance), 0))}
                    </div>
                  </Card>
                </div>
                {commissionRevenue === 0 && (
                  <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-xs text-white/40">
                    Ainda não há vendas de afiliados registradas nesse período.
                  </p>
                )}
                <Card>
                  <h3 className="text-sm font-bold">Ranking de afiliados</h3>
                  <p className="mb-2 text-[11.5px] text-white/30">Por vendas geradas no período</p>
                  {afiliadoRanking.length ? (
                    afiliadoRanking.map((p, i) => (
                      <RankRow key={p.name + i} rank={i + 1} name={p.name} pct={(p.value / maxRank(afiliadoRanking)) * 100} value={formatCurrencyCompact(p.value)} hex={COLOR_HEX.afil} />
                    ))
                  ) : (
                    <p className="text-sm text-white/25">Nenhuma venda de afiliado no período.</p>
                  )}
                </Card>
              </div>
            )}

            {/* ---------- painel Assinaturas ---------- */}
            {tab === "assinaturas" && (
              <div className="mt-4 space-y-4">
                <Card>
                  <h3 className="text-sm font-bold">Receita recorrente mensal (MRR)</h3>
                  <p className="mb-3 text-[11.5px] text-white/30">Clube de assinatura + mensalidade dos afiliados no Hub</p>
                  <div className="grid grid-cols-1 gap-4 border-t border-white/[0.06] pt-3 sm:grid-cols-3">
                    <div>
                      <div className="text-xl font-bold tabular-nums">{formatCurrency(mrrTotal)}</div>
                      <div className="text-[11.5px] text-white/30">MRR total</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold tabular-nums" style={{ color: COLOR_HEX.assin }}>
                        {formatCurrency(mrrClube)}
                      </div>
                      <div className="text-[11.5px] text-white/30">clube de clientes · {clubActive.length} assinantes</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold tabular-nums" style={{ color: COLOR_HEX.afil }}>
                        {formatCurrency(mrrAfiliados)}
                      </div>
                      <div className="text-[11.5px] text-white/30">mensalidade dos afiliados · {activePartnerships.filter((p) => p.subscription_price).length} planos</div>
                    </div>
                  </div>
                </Card>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Card>
                    <h3 className="text-sm font-bold">Clube de clientes</h3>
                    <p className="mb-2 text-[11.5px] text-white/30">Assinantes ativos</p>
                    {clubActive.length ? (
                      clubActive.slice(0, 6).map((c) => (
                        <div key={c.id} className="flex items-center justify-between border-b border-white/[0.06] py-2 text-sm last:border-0">
                          <span className="text-white/70">{c.customer_name || c.customer_phone}</span>
                          <span className="font-bold tabular-nums">{formatCurrency(c.monthly_amount)}/mês</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-white/25">Nenhum assinante ativo ainda.</p>
                    )}
                  </Card>
                  <Card>
                    <h3 className="text-sm font-bold">Próximos vencimentos (afiliados)</h3>
                    <p className="mb-2 text-[11.5px] text-white/30">Nos próximos 7 dias</p>
                    {upcomingAfiliadoRenewals.length ? (
                      upcomingAfiliadoRenewals.map((p) => (
                        <div key={p.id} className="flex items-center justify-between border-b border-white/[0.06] py-2 text-sm last:border-0">
                          <span className="text-white/70">{p.owner_name}</span>
                          <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "rgba(240,187,94,0.14)", color: COLOR_HEX.warning }}>
                            {new Date(p.subscription_due_at!).toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-white/25">Nenhum vencimento nos próximos 7 dias.</p>
                    )}
                  </Card>
                </div>
              </div>
            )}

            {/* ---------- painel Entregadores ---------- */}
            {tab === "entregadores" && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Card>
                    <h3 className="text-sm font-bold">Pago no período</h3>
                    <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: COLOR_HEX.negative }}>
                      {formatCurrency(totalPagoEntregas)}
                    </div>
                  </Card>
                  <Card>
                    <h3 className="text-sm font-bold">A pagar</h3>
                    <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: COLOR_HEX.warning }}>
                      {formatCurrency(totalAPagarEntregas)}
                    </div>
                  </Card>
                  <Card>
                    <h3 className="text-sm font-bold">Custo médio por entrega</h3>
                    <div className="mt-2 text-2xl font-bold tabular-nums">{formatCurrency(custoMedioEntrega)}</div>
                  </Card>
                </div>
                <Card>
                  <h3 className="text-sm font-bold">Entregas por entregador</h3>
                  <p className="mb-2 text-[11.5px] text-white/30">Pago + a pagar no período</p>
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
                    <p className="text-sm text-white/25">Nenhum entregador cadastrado ainda.</p>
                  )}
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
