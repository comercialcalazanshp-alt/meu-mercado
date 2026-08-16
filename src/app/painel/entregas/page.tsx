"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type DeliveryOrder = {
  id: string;
  customer_name: string;
  customer_phone: string;
  total: number;
  status: string;
  created_at: string;
  delivery_address: string;
  neighborhood_name: string | null;
  payment_method: string | null;
  pix_paid_at: string | null;
  card_paid_at: string | null;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function paymentInfo(order: DeliveryOrder): { label: string; value: string; due: boolean } {
  if (order.payment_method === "pix") {
    return order.pix_paid_at
      ? { label: "✓ Pago no site (Pix)", value: "Nada a cobrar", due: false }
      : { label: "⏳ Pix ainda não confirmado", value: formatCurrency(order.total), due: true };
  }
  if (order.payment_method === "cartao") {
    return order.card_paid_at
      ? { label: "✓ Pago no site (cartão)", value: "Nada a cobrar", due: false }
      : { label: "⏳ Cartão ainda não confirmado", value: formatCurrency(order.total), due: true };
  }
  return { label: "💵 Cobrar na entrega", value: formatCurrency(order.total), due: true };
}

export default function Entregas() {
  const store = useStore();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [historyToday, setHistoryToday] = useState(0);
  const [historyWeek, setHistoryWeek] = useState(0);
  const [myEarnings, setMyEarnings] = useState<{ count: number; valuePerDelivery: number } | null>(null);

  async function load() {
    const supabase = getSupabase();

    const { data } = await supabase
      .from("orders")
      .select(
        "id, customer_name, customer_phone, total, status, created_at, delivery_address, neighborhood_name, payment_method, pix_paid_at, card_paid_at",
      )
      .eq("store_id", store.id)
      .in("status", ["confirmado", "entregando"])
      .not("delivery_address", "is", null)
      .order("created_at", { ascending: true });
    setOrders((data ?? []) as DeliveryOrder[]);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);

    const { count: todayCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id)
      .gte("delivered_at", startOfToday.toISOString());
    setHistoryToday(todayCount ?? 0);

    const { count: weekCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id)
      .gte("delivered_at", startOfWeek.toISOString());
    setHistoryWeek(weekCount ?? 0);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session && session.user.id !== store.owner_id) {
      const { data: myMember } = await supabase
        .from("store_members")
        .select("id, value_per_delivery")
        .eq("store_id", store.id)
        .eq("role", "entregador")
        .maybeSingle();
      if (myMember?.value_per_delivery != null) {
        const { count: pendingCount } = await supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("store_id", store.id)
          .eq("delivered_by", myMember.id)
          .eq("delivery_payout_settled", false);
        setMyEarnings({ count: pendingCount ?? 0, valuePerDelivery: myMember.value_per_delivery });
      } else {
        setMyEarnings(null);
      }
    } else {
      setMyEarnings(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function markEmRota(id: string) {
    setUpdatingId(id);
    await getSupabase().from("orders").update({ status: "entregando" }).eq("id", id);
    await load();
    setUpdatingId(null);
  }

  async function markEntregue(id: string) {
    setUpdatingId(id);
    await getSupabase()
      .from("orders")
      .update({ status: "entregue", delivered_at: new Date().toISOString() })
      .eq("id", id);
    await load();
    setUpdatingId(null);
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Entregas</h1>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-lg font-bold text-slate-900 dark:text-slate-50">{historyToday}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">entregues hoje</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-lg font-bold text-slate-900 dark:text-slate-50">{historyWeek}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">essa semana</p>
        </div>
      </div>

      {myEarnings && (
        <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-center dark:border-amber-700 dark:bg-amber-900/10">
          <p className="text-lg font-bold text-amber-800 dark:text-amber-400">
            {formatCurrency(myEarnings.count * myEarnings.valuePerDelivery)}
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            a receber · {myEarnings.count} entrega(s) × {formatCurrency(myEarnings.valuePerDelivery)}
          </p>
        </div>
      )}

      <p className="mt-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Pedidos pra entregar</p>

      {loading && <p className="mt-3 text-sm text-slate-500">Carregando…</p>}
      {!loading && orders.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">Nenhuma entrega pendente agora.</p>
      )}

      <div className="mt-2 flex flex-col gap-3">
        {orders.map((order) => {
          const pay = paymentInfo(order);
          const busy = updatingId === order.id;
          return (
            <div
              key={order.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">{formatTime(order.created_at)}</p>
                <span
                  className={
                    order.status === "entregando"
                      ? "rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-400"
                      : "rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                  }
                >
                  {order.status === "entregando" ? "Em rota" : "Pronto pra sair"}
                </span>
              </div>

              <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">
                {order.customer_name}
              </p>

              <div
                className={
                  pay.due
                    ? "mt-2 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-900/20"
                    : "mt-2 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 dark:bg-green-900/20"
                }
              >
                <span
                  className={
                    pay.due
                      ? "text-xs font-semibold text-amber-800 dark:text-amber-400"
                      : "text-xs font-semibold text-green-700 dark:text-green-400"
                  }
                >
                  {pay.label}
                </span>
                <span
                  className={
                    pay.due
                      ? "text-sm font-bold text-amber-800 dark:text-amber-400"
                      : "text-sm font-bold text-green-700 dark:text-green-400"
                  }
                >
                  {pay.value}
                </span>
              </div>

              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-slate-50">Entregar em: </span>
                {order.delivery_address}
                {order.neighborhood_name ? ` — ${order.neighborhood_name}` : ""}
              </div>

              <div className="mt-3 flex gap-2">
                <a
                  href={`https://wa.me/55${order.customer_phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-center text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  WhatsApp
                </a>
                {order.status === "confirmado" ? (
                  <button
                    onClick={() => markEmRota(order.id)}
                    disabled={busy}
                    className="flex-[2] rounded-lg bg-blue-900 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
                  >
                    {busy ? "Salvando…" : "Saiu pra entrega"}
                  </button>
                ) : (
                  <button
                    onClick={() => markEntregue(order.id)}
                    disabled={busy}
                    className="flex-[2] rounded-lg bg-blue-900 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
                  >
                    {busy ? "Salvando…" : "Marcar entregue"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
