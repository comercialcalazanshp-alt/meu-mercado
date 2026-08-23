"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Visit = {
  session_id: string;
  first_seen_at: string;
  last_seen_at: string;
  page_views: number;
  converted: boolean;
};

const DAYS_FOR_CHART = 14;
const RANGE_DAYS = 30;

function shortDay(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export default function Trafego() {
  const store = useStore();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [prevVisits, setPrevVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const since = new Date();
      since.setDate(since.getDate() - RANGE_DAYS);
      const prevSince = new Date();
      prevSince.setDate(prevSince.getDate() - RANGE_DAYS * 2);
      const [{ data }, { data: prevData }] = await Promise.all([
        getSupabase()
          .from("site_visits")
          .select("session_id, first_seen_at, last_seen_at, page_views, converted")
          .eq("store_id", store.id)
          .gte("first_seen_at", since.toISOString())
          .order("first_seen_at", { ascending: true }),
        getSupabase()
          .from("site_visits")
          .select("session_id, first_seen_at, last_seen_at, page_views, converted")
          .eq("store_id", store.id)
          .gte("first_seen_at", prevSince.toISOString())
          .lt("first_seen_at", since.toISOString()),
      ]);
      setVisits(data ?? []);
      setPrevVisits(prevData ?? []);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  function pctDelta(current: number, previous: number): number | null {
    if (previous <= 0) return current > 0 ? 100 : null;
    return Math.round(((current - previous) / previous) * 100);
  }

  function DeltaBadge({ current, previous }: { current: number; previous: number }) {
    const delta = pctDelta(current, previous);
    if (delta === null) return null;
    return (
      <span className={`text-xs font-semibold ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
        {delta >= 0 ? "+" : ""}
        {delta}% vs. período anterior
      </span>
    );
  }

  const totalVisits = visits.length;
  const conversions = visits.filter((v) => v.converted).length;
  const conversionRate = totalVisits > 0 ? (conversions / totalVisits) * 100 : 0;
  const avgPageViews =
    totalVisits > 0 ? visits.reduce((sum, v) => sum + v.page_views, 0) / totalVisits : 0;

  const prevTotalVisits = prevVisits.length;
  const prevConversions = prevVisits.filter((v) => v.converted).length;
  const prevConversionRate = prevTotalVisits > 0 ? (prevConversions / prevTotalVisits) * 100 : 0;
  const prevAvgPageViews =
    prevTotalVisits > 0 ? prevVisits.reduce((sum, v) => sum + v.page_views, 0) / prevTotalVisits : 0;

  const avgDurationSeconds = useMemo(() => {
    if (visits.length === 0) return 0;
    const total = visits.reduce((sum, v) => {
      const seconds = (new Date(v.last_seen_at).getTime() - new Date(v.first_seen_at).getTime()) / 1000;
      return sum + Math.max(0, seconds);
    }, 0);
    return total / visits.length;
  }, [visits]);

  const visitsByDay = useMemo(() => {
    const map = new Map<string, number>();
    const today = new Date();
    for (let i = DAYS_FOR_CHART - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      map.set(d.toISOString().slice(0, 10), 0);
    }
    for (const visit of visits) {
      const key = dayKey(visit.first_seen_at);
      if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries());
  }, [visits]);

  const maxDayVisits = Math.max(1, ...visitsByDay.map(([, v]) => v));

  function formatDuration(seconds: number) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.round(seconds / 60)}min`;
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Tráfego do site (últimos {RANGE_DAYS} dias)
      </h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{totalVisits}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">visitas</p>
          <div className="mt-1">
            <DeltaBadge current={totalVisits} previous={prevTotalVisits} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {conversionRate.toFixed(0)}%
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">converteram em pedido</p>
          <div className="mt-1">
            <DeltaBadge current={conversionRate} previous={prevConversionRate} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {avgPageViews.toFixed(1)}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">telas por visita</p>
          <div className="mt-1">
            <DeltaBadge current={avgPageViews} previous={prevAvgPageViews} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {formatDuration(avgDurationSeconds)}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">tempo médio no site</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Visitas dos últimos {DAYS_FOR_CHART} dias
        </h2>
        <div className="mt-4 flex items-end gap-1" style={{ height: 120 }}>
          {visitsByDay.map(([date, value]) => (
            <div key={date} className="flex flex-1 flex-col items-center gap-1">
              <div
                title={`${value} visita(s)`}
                className="w-full rounded-t bg-blue-900 dark:bg-blue-700"
                style={{ height: `${Math.max(2, (value / maxDayVisits) * 100)}px` }}
              />
              <span className="text-[10px] text-slate-400 dark:text-slate-500">{shortDay(date)}</span>
            </div>
          ))}
        </div>
      </div>

      {totalVisits === 0 && (
        <p className="text-sm text-slate-500">
          Nenhuma visita registrada ainda nos últimos {RANGE_DAYS} dias.
        </p>
      )}
    </div>
  );
}
