"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Order = {
  id: string;
  store_id: string;
  total: number;
  status: string;
  created_at: string;
  customer_phone: string | null;
};

type Partnership = {
  id: string;
  module_store_id: string;
  category: string;
  owner_name: string;
  active: boolean;
  balance: number;
  commission_percent: number;
  subscription_price: number | null;
  subscription_due_at: string | null;
  payout_method: string;
};

function formatCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

// Constrói uma curva suave (quadrática, passando pelos pontos médios) a
// partir de uma lista de valores — mesma técnica usada na prévia aprovada,
// só que agora com números de verdade em vez de fixos.
function buildSmoothPath(values: number[], width: number, height: number, padTop: number, padBottom: number) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    y: padTop + (1 - (v - min) / range) * (height - padTop - padBottom),
  }));
  if (points.length < 2) return { line: "", area: "", last: points[0] ?? { x: 0, y: height } };
  let line = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const next = points[i + 1];
    const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
    line += ` Q${p.x},${p.y} ${mid.x},${mid.y}`;
  }
  const last = points[points.length - 1];
  line += ` Q${last.x},${last.y} ${last.x},${last.y}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area, last };
}

export default function PainelInicio() {
  const store = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [visits, setVisits] = useState(0);
  const [extraSales, setExtraSales] = useState<{ price: number; paid_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabase();
      const since = new Date();
      since.setDate(since.getDate() - 13);
      since.setHours(0, 0, 0, 0);
      const sinceIso = since.toISOString();

      // Usa get_hub_orders/get_hub_visits_count em vez de filtrar direto por
      // store_id: pra uma loja comum (ou afiliado) isso devolve exatamente
      // os próprios dados, sem diferença — mas pra Hub soma o marketplace
      // inteiro (a própria loja, se ainda vender algo, + cada afiliado
      // ativo), já que a Hub não tem mais pedido nenhum só dela.
      const [ordersRes, partnershipsRes, visitsRes, extraSalesRes] = await Promise.all([
        supabase.rpc("get_hub_orders", { p_hub_store_id: store.id, p_since: sinceIso }),
        supabase
          .from("affiliate_partnerships")
          .select("id, module_store_id, category, owner_name, active, balance, commission_percent, subscription_price, subscription_due_at, payout_method")
          .eq("hub_store_id", store.id),
        supabase.rpc("get_hub_visits_count", { p_hub_store_id: store.id, p_since: sinceIso }),
        // Venda avulsa (pacote extra de imagem por IA) é dinheiro que entra
        // direto pra Hub — RLS já filtra sozinho pra só as parcerias dessa
        // Hub (affiliate_ai_purchases é ligado por partnership_id).
        supabase.from("affiliate_ai_purchases").select("price, paid_at").not("paid_at", "is", null).gte("paid_at", sinceIso),
      ]);
      if (cancelled) return;
      setOrders((ordersRes.data as Order[]) ?? []);
      setPartnerships((partnershipsRes.data as Partnership[]) ?? []);
      setVisits((visitsRes.data as number) ?? 0);
      setExtraSales((extraSalesRes.data as { price: number; paid_at: string }[]) ?? []);
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const todayKey = dayKey(new Date().toISOString());
  const yesterdayKey = dayKey(new Date(Date.now() - 86400000).toISOString());

  const validOrders = useMemo(() => orders.filter((o) => o.status !== "cancelado"), [orders]);

  // Pra pedido de afiliado, a Hub só ganha a comissão — não o valor cheio
  // do pedido (esse dinheiro é do afiliado). Pedido da própria loja da Hub
  // (se ela ainda vender algo) conta o valor inteiro.
  const commissionPercentByStore = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of partnerships) if (p.active) map.set(p.module_store_id, p.commission_percent);
    return map;
  }, [partnerships]);

  function hubShare(o: Order): number {
    if (o.store_id === store.id) return o.total;
    const pct = commissionPercentByStore.get(o.store_id);
    return pct ? o.total * (pct / 100) : 0;
  }

  const revenueByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of validOrders) {
      const k = dayKey(o.created_at);
      map.set(k, (map.get(k) ?? 0) + hubShare(o));
    }
    // Venda avulsa (pacote extra de IA etc.) é receita direta da Hub — entra
    // no mesmo total do dia, junto da comissão.
    for (const sale of extraSales) {
      const k = dayKey(sale.paid_at);
      map.set(k, (map.get(k) ?? 0) + sale.price);
    }
    const days: { key: string; total: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dayKey(d.toISOString());
      days.push({ key: k, total: map.get(k) ?? 0 });
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validOrders, commissionPercentByStore, extraSales]);

  const revenueToday = revenueByDay[revenueByDay.length - 1]?.total ?? 0;
  const revenueYesterday = useMemo(
    () => revenueByDay.find((d) => d.key === yesterdayKey)?.total ?? 0,
    [revenueByDay, yesterdayKey],
  );
  const deltaPercent = revenueYesterday > 0 ? Math.round(((revenueToday - revenueYesterday) / revenueYesterday) * 100) : null;

  const ordersToday = useMemo(() => validOrders.filter((o) => dayKey(o.created_at) === todayKey), [validOrders, todayKey]);
  const delivered = ordersToday.filter((o) => o.status === "entregue").length;
  const enRoute = ordersToday.filter((o) => o.status === "confirmado" || o.status === "entregando").length;
  const pending = ordersToday.filter((o) => o.status === "pendente").length;
  const donutTotal = Math.max(delivered + enRoute + pending, 1);

  // Comissão sobre venda de afiliado + venda avulsa (pacote extra de IA
  // etc.) de hoje — exclui venda própria da Hub, que já é faturamento
  // direto contado à parte.
  const commissionToday = useMemo(
    () => ordersToday.filter((o) => o.store_id !== store.id).reduce((s, o) => s + hubShare(o), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordersToday, commissionPercentByStore, store.id],
  );
  const extraSalesToday = useMemo(
    () => extraSales.filter((s) => dayKey(s.paid_at) === todayKey).reduce((sum, s) => sum + s.price, 0),
    [extraSales, todayKey],
  );

  const activePartnerships = useMemo(() => partnerships.filter((p) => p.active), [partnerships]);
  // Só "manual" acumula saldo pra repassar de verdade — quem está em split
  // automático já recebe na hora da venda, então o saldo dele não é uma
  // dívida pendente (mostrar isso como "a repassar" seria enganoso).
  const pendingPayout = useMemo(
    () => activePartnerships.filter((p) => p.payout_method === "manual").reduce((s, p) => s + Math.max(0, p.balance), 0),
    [activePartnerships],
  );
  const uniqueCustomers = useMemo(
    () => new Set(validOrders.map((o) => o.customer_phone).filter(Boolean)).size,
    [validOrders],
  );

  // MRR: soma da mensalidade de todo afiliado ativo com plano pago — é o
  // que a Hub deveria receber por mês se todo mundo pagasse em dia (ainda
  // não cobra sozinho, é só a expectativa pra planejar).
  const mrr = useMemo(
    () => activePartnerships.reduce((s, p) => s + (p.subscription_price ?? 0), 0),
    [activePartnerships],
  );
  const overduePartnerships = useMemo(
    () => activePartnerships.filter((p) => p.subscription_due_at && new Date(p.subscription_due_at) < new Date()),
    [activePartnerships],
  );
  const overdueAmount = useMemo(
    () => overduePartnerships.reduce((s, p) => s + (p.subscription_price ?? 0), 0),
    [overduePartnerships],
  );

  // Contagem de pedidos por dia — separado do faturamento de propósito:
  // isso conta TODO pedido do marketplace (inclui o valor cheio que é do
  // afiliado), então não pode virar dinheiro na mesma conta do faturamento.
  const ordersCountByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of validOrders) {
      const k = dayKey(o.created_at);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    const days: { key: string; total: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dayKey(d.toISOString());
      days.push({ key: k, total: map.get(k) ?? 0 });
    }
    return days;
  }, [validOrders]);

  const ordersChart = useMemo(
    () => buildSmoothPath(ordersCountByDay.map((d) => d.total), 400, 90, 8, 12),
    [ordersCountByDay],
  );

  const chart = useMemo(
    () => buildSmoothPath(revenueByDay.map((d) => d.total), 400, 150, 8, 20),
    [revenueByDay],
  );

  const donutCirc = 251;
  const deliveredOffset = donutCirc - (delivered / donutTotal) * donutCirc;
  const enRouteOffset = donutCirc - ((delivered + enRoute) / donutTotal) * donutCirc;
  const pendingOffset = donutCirc - ((delivered + enRoute + pending) / donutTotal) * donutCirc;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-white/40">
        Carregando…
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-black">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -top-44 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-50 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(52,232,140,0.20), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-36 top-56 h-[420px] w-[420px] rounded-full opacity-50 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(92,172,255,0.14), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-36 -bottom-16 h-[380px] w-[380px] rounded-full opacity-30 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(255,92,104,0.10), transparent 65%)" }}
      />

      <div className="relative max-w-3xl px-4 py-8 text-[#F5F3EF] sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#F0BB5E] text-[11px] font-extrabold text-[#241705]">
              MM
            </span>
            <div>
              <h1 className="text-base font-extrabold">{store.name}</h1>
              <p className="mt-0.5 text-[11.5px] text-white/35">Visão do marketplace · hoje</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-[#34E88C]/25 bg-[#34E88C]/10 px-2.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-[#34E88C]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34E88C]" />
            Ao vivo
          </span>
        </div>

        <div className="py-4 text-center">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-white/30">Faturamento de hoje</p>
          <p
            className="my-1.5 text-[46px] font-black tracking-tight sm:text-[60px]"
            style={{
              backgroundImage: "linear-gradient(180deg, #EFFFF6 0%, #34E88C 120%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              textShadow: "0 0 60px rgba(52,232,140,0.35)",
            }}
          >
            {formatCurrency(revenueToday)}
          </p>
          {deltaPercent !== null ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#34E88C]/22 bg-[#34E88C]/10 px-3 py-1.5 text-[13px] font-bold text-[#34E88C]">
              {deltaPercent >= 0 ? "↑" : "↓"} {Math.abs(deltaPercent)}% em relação a ontem
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] font-medium text-white/40">
              Sem venda ontem pra comparar
            </span>
          )}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">Comissão + vendas avulsas</p>
            <p className="mt-1.5 text-[21px] font-extrabold tabular-nums text-[#5CACFF]">
              {formatCurrency(commissionToday + extraSalesToday)}
            </p>
            <p className="mt-0.5 text-[11.5px] font-semibold text-white/30">
              {formatCurrency(commissionToday)} comissão · {formatCurrency(extraSalesToday)} avulsa
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">A repassar</p>
            <p className="mt-1.5 text-[21px] font-extrabold tabular-nums text-[#FF5C68]">{formatCurrency(pendingPayout)}</p>
            <p className="mt-0.5 text-[11.5px] font-semibold text-[#FF5C68]/85">
              {pendingPayout > 0 ? "repasse pendente" : "tudo em dia"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">Clientes atendidos</p>
            <p className="mt-1.5 text-[21px] font-extrabold tabular-nums text-[#F5F3EF]">{uniqueCustomers}</p>
            <p className="mt-0.5 text-[11.5px] font-semibold text-white/30">últimos 14 dias</p>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">Visitas no site</p>
            <p className="mt-1.5 text-[21px] font-extrabold tabular-nums text-[#F5F3EF]">{visits}</p>
            <p className="mt-0.5 text-[11.5px] font-semibold text-white/30">últimos 14 dias</p>
          </div>
        </div>

        <div className="mb-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-[1.6fr,1fr]">
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-5 backdrop-blur-xl">
            <h2 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-white/45">Faturamento — últimos 14 dias</h2>
            <svg viewBox="0 0 400 150" width="100%" height="150" preserveAspectRatio="none">
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34E88C" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#34E88C" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" y1="37.5" x2="400" y2="37.5" stroke="rgba(255,255,255,0.05)" />
              <line x1="0" y1="75" x2="400" y2="75" stroke="rgba(255,255,255,0.05)" />
              <line x1="0" y1="112.5" x2="400" y2="112.5" stroke="rgba(255,255,255,0.05)" />
              {chart.area && <path d={chart.area} fill="url(#areaGrad)" />}
              {chart.line && (
                <path
                  d={chart.line}
                  fill="none"
                  stroke="#34E88C"
                  strokeWidth="2.5"
                  style={{ filter: "drop-shadow(0 0 8px rgba(52,232,140,0.6))" }}
                />
              )}
              {chart.last && <circle cx={chart.last.x} cy={chart.last.y} r="4.5" fill="#EFFFF6" style={{ filter: "drop-shadow(0 0 6px rgba(52,232,140,0.9))" }} />}
            </svg>
          </div>

          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-5 backdrop-blur-xl">
            <h2 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-white/45">Pedidos hoje</h2>
            <div className="flex items-center gap-4">
              <svg width="100" height="100" viewBox="0 0 110 110" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="55" cy="55" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                <circle
                  cx="55" cy="55" r="40" fill="none" stroke="#34E88C" strokeWidth="12" strokeLinecap="round"
                  pathLength={donutCirc} strokeDasharray={donutCirc} strokeDashoffset={deliveredOffset}
                  style={{ filter: "drop-shadow(0 0 5px rgba(52,232,140,0.6))" }}
                />
                <circle
                  cx="55" cy="55" r="40" fill="none" stroke="#5CACFF" strokeWidth="12" strokeLinecap="round"
                  pathLength={donutCirc} strokeDasharray={donutCirc} strokeDashoffset={enRouteOffset}
                  style={{ filter: "drop-shadow(0 0 5px rgba(92,172,255,0.6))" }}
                />
                <circle
                  cx="55" cy="55" r="40" fill="none" stroke="#FF5C68" strokeWidth="12" strokeLinecap="round"
                  pathLength={donutCirc} strokeDasharray={donutCirc} strokeDashoffset={pendingOffset}
                  style={{ filter: "drop-shadow(0 0 5px rgba(255,92,104,0.6))" }}
                />
              </svg>
              <div className="flex flex-col gap-2 text-[12.5px]">
                <span className="flex items-center gap-1.5 text-white/55"><span className="h-2 w-2 rounded-full bg-[#34E88C]" />Entregues<b className="ml-1 tabular-nums text-[#F5F3EF]">{delivered}</b></span>
                <span className="flex items-center gap-1.5 text-white/55"><span className="h-2 w-2 rounded-full bg-[#5CACFF]" />Em rota<b className="ml-1 tabular-nums text-[#F5F3EF]">{enRoute}</b></span>
                <span className="flex items-center gap-1.5 text-white/55"><span className="h-2 w-2 rounded-full bg-[#FF5C68]" />Pendentes<b className="ml-1 tabular-nums text-[#F5F3EF]">{pending}</b></span>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-2.5 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-5 backdrop-blur-xl">
          <h2 className="mb-1 text-[12.5px] font-bold uppercase tracking-wide text-white/45">Pedidos — últimos 14 dias</h2>
          <p className="mb-3 text-[11px] text-white/25">Volume de pedidos do marketplace (não é dinheiro seu — cada um é do afiliado que vendeu)</p>
          <svg viewBox="0 0 400 90" width="100%" height="90" preserveAspectRatio="none">
            <defs>
              <linearGradient id="ordersAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5CACFF" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#5CACFF" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="45" x2="400" y2="45" stroke="rgba(255,255,255,0.05)" />
            {ordersChart.area && <path d={ordersChart.area} fill="url(#ordersAreaGrad)" />}
            {ordersChart.line && (
              <path
                d={ordersChart.line}
                fill="none"
                stroke="#5CACFF"
                strokeWidth="2.5"
                style={{ filter: "drop-shadow(0 0 8px rgba(92,172,255,0.6))" }}
              />
            )}
            {ordersChart.last && (
              <circle cx={ordersChart.last.x} cy={ordersChart.last.y} r="4" fill="#EAF3FF" style={{ filter: "drop-shadow(0 0 6px rgba(92,172,255,0.9))" }} />
            )}
          </svg>
        </div>

        <div className="mb-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">Mensalidades — MRR</p>
            <p className="mt-1.5 text-[21px] font-extrabold tabular-nums text-[#F5F3EF]">{formatCurrency(mrr)}</p>
            <p className="mt-0.5 text-[11.5px] font-semibold text-white/30">
              se todo mundo pagar em dia · {activePartnerships.length} afiliado(s)
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">Mensalidade atrasada</p>
            <p className={`mt-1.5 text-[21px] font-extrabold tabular-nums ${overduePartnerships.length > 0 ? "text-[#FF5C68]" : "text-[#F5F3EF]"}`}>
              {formatCurrency(overdueAmount)}
            </p>
            <p className={`mt-0.5 text-[11.5px] font-semibold ${overduePartnerships.length > 0 ? "text-[#FF5C68]/85" : "text-white/30"}`}>
              {overduePartnerships.length > 0 ? `${overduePartnerships.length} afiliado(s) atrasado(s)` : "tudo em dia"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-5 backdrop-blur-xl">
          <h2 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-white/45">Afiliados</h2>
          {partnerships.length === 0 ? (
            <p className="text-[13px] text-white/35">Nenhum afiliado cadastrado ainda.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {partnerships.map((p) => {
                const isOverdue = p.active && p.subscription_due_at && new Date(p.subscription_due_at) < new Date();
                return (
                  <div key={p.id} className="flex items-center gap-2.5">
                    <span className="w-24 flex-shrink-0 truncate text-[12.5px] text-white/55">{p.owner_name}</span>
                    <span className="flex-1" />
                    {isOverdue && (
                      <span className="rounded-full bg-[#FF5C68]/12 px-2 py-0.5 text-[10.5px] font-bold text-[#FF5C68]">
                        mensalidade atrasada
                      </span>
                    )}
                    <span className={`text-[11.5px] font-semibold ${p.active ? "text-[#34E88C]" : "text-white/30"}`}>
                      {p.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
