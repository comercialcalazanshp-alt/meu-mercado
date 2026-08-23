"use client";

import { useEffect, useMemo, useState } from "react";
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

type HubDeliveryLeg = {
  hub_order_id: string;
  hub_customer_name: string;
  hub_customer_phone: string;
  hub_order_created_at: string;
  order_id: string;
  order_store_id: string;
  order_store_name: string;
  order_status: string;
  order_total: number;
  order_payment_method: string | null;
  order_pix_paid_at: string | null;
  order_card_paid_at: string | null;
  order_delivery_address: string;
  stop_address: string | null;
  stop_lat: number | null;
  stop_lng: number | null;
  stop_picked_up_at: string | null;
};

type HubDelivery = {
  hubOrderId: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  legs: HubDeliveryLeg[];
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function paymentInfo(payment_method: string | null, pix_paid_at: string | null, card_paid_at: string | null, total: number) {
  if (payment_method === "pix") {
    return pix_paid_at
      ? { label: "✓ Pago no site (Pix)", value: "Nada a cobrar", due: false }
      : { label: "⏳ Pix ainda não confirmado", value: formatCurrency(total), due: true };
  }
  if (payment_method === "cartao") {
    return card_paid_at
      ? { label: "✓ Pago no site (cartão)", value: "Nada a cobrar", due: false }
      : { label: "⏳ Cartão ainda não confirmado", value: formatCurrency(total), due: true };
  }
  return { label: "💵 Cobrar na entrega", value: formatCurrency(total), due: true };
}

export default function Entregas() {
  const store = useStore();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [hubLegs, setHubLegs] = useState<HubDeliveryLeg[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [historyToday, setHistoryToday] = useState(0);
  const [historyWeek, setHistoryWeek] = useState(0);
  const [myEarnings, setMyEarnings] = useState<{ count: number; valuePerDelivery: number } | null>(null);

  async function load() {
    const supabase = getSupabase();

    // hub_order_id null: pedido direto dessa loja só. Pedido de Hub
    // (carrinho com várias lojas) some daqui e aparece agrupado em
    // hubDeliveries — senão o entregador veria a perna de uma loja só,
    // sem saber que faz parte de uma entrega maior.
    const [{ data }, { data: hubData }] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id, customer_name, customer_phone, total, status, created_at, delivery_address, neighborhood_name, payment_method, pix_paid_at, card_paid_at",
        )
        .eq("store_id", store.id)
        .in("status", ["confirmado", "entregando"])
        .not("delivery_address", "is", null)
        .is("hub_order_id", null)
        .order("created_at", { ascending: true }),
      supabase.rpc("get_hub_delivery_orders", { p_store_id: store.id }),
    ]);
    setOrders((data ?? []) as DeliveryOrder[]);
    setHubLegs((hubData ?? []) as HubDeliveryLeg[]);

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

  const hubDeliveries: HubDelivery[] = useMemo(() => {
    const map = new Map<string, HubDelivery>();
    for (const leg of hubLegs) {
      const existing = map.get(leg.hub_order_id);
      if (existing) {
        existing.legs.push(leg);
      } else {
        map.set(leg.hub_order_id, {
          hubOrderId: leg.hub_order_id,
          customerName: leg.hub_customer_name,
          customerPhone: leg.hub_customer_phone,
          createdAt: leg.hub_order_created_at,
          legs: [leg],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [hubLegs]);

  async function reportIssue(orderId: string) {
    const description = prompt("O que aconteceu com essa entrega? (endereço errado, cliente ausente, recusou o pedido, etc.)");
    if (!description || !description.trim()) return;
    const { error } = await getSupabase().from("delivery_issues").insert({
      order_id: orderId,
      store_id: store.id,
      description: description.trim(),
    });
    if (error) {
      alert("Não deu pra registrar: " + error.message);
      return;
    }
    alert("Avisado! O dono da loja vai receber uma notificação.");
  }

  async function markEmRota(id: string) {
    setUpdatingId(id);
    await getSupabase()
      .from("orders")
      .update({ status: "entregando", out_for_delivery_at: new Date().toISOString() })
      .eq("id", id);
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

  async function markHubStatus(hubOrderId: string, status: "entregando" | "entregue") {
    setUpdatingId(hubOrderId);
    await getSupabase().rpc("update_hub_delivery_status", { p_hub_order_id: hubOrderId, p_status: status });
    await load();
    setUpdatingId(null);
  }

  const totalPending = orders.length + hubDeliveries.length;

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
      {!loading && totalPending === 0 && <p className="mt-3 text-sm text-slate-500">Nenhuma entrega pendente agora.</p>}

      <div className="mt-2 flex flex-col gap-3">
        {hubDeliveries.map((delivery) => {
          const busy = updatingId === delivery.hubOrderId;
          const anyConfirmado = delivery.legs.some((l) => l.order_status === "confirmado");
          const first = delivery.legs[0];
          const pay = paymentInfo(first.order_payment_method, first.order_pix_paid_at, first.order_card_paid_at, first.order_total);
          const totalGeral = delivery.legs.reduce((s, l) => s + l.order_total, 0);
          const deliveryAddresses = Array.from(new Set(delivery.legs.map((l) => l.order_delivery_address)));

          return (
            <div
              key={delivery.hubOrderId}
              className="rounded-xl border-2 border-indigo-200 bg-white p-4 dark:border-indigo-900/50 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">{formatTime(delivery.createdAt)}</p>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                  {delivery.legs.length} paradas · {anyConfirmado ? "Pronto pra sair" : "Em rota"}
                </span>
              </div>

              <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">{delivery.customerName}</p>

              <div
                className={
                  pay.due
                    ? "mt-2 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-900/20"
                    : "mt-2 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 dark:bg-green-900/20"
                }
              >
                <span className={pay.due ? "text-xs font-semibold text-amber-800 dark:text-amber-400" : "text-xs font-semibold text-green-700 dark:text-green-400"}>
                  {pay.label}
                </span>
                <span className={pay.due ? "text-sm font-bold text-amber-800 dark:text-amber-400" : "text-sm font-bold text-green-700 dark:text-green-400"}>
                  {pay.due ? formatCurrency(totalGeral) : pay.value}
                </span>
              </div>

              <div className="mt-2 flex flex-col gap-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Retirar em, nessa ordem:</p>
                {delivery.legs.map((leg, i) => (
                  <a
                    key={leg.order_id}
                    href={mapsUrl(leg.stop_address ?? leg.order_store_name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <span>
                      <b className="text-slate-900 dark:text-slate-50">
                        {i + 1}. {leg.order_store_name}
                      </b>{" "}
                      — {leg.stop_address ?? "sem endereço cadastrado"}
                    </span>
                    <span className="shrink-0 text-indigo-600 dark:text-indigo-400">🗺️</span>
                  </a>
                ))}
              </div>

              <div className="mt-2 flex flex-col gap-1">
                {deliveryAddresses.map((addr) => (
                  <a
                    key={addr}
                    href={mapsUrl(addr)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <span>
                      <span className="font-semibold text-slate-900 dark:text-slate-50">Entregar em: </span>
                      {addr}
                    </span>
                    <span className="shrink-0 text-indigo-600 dark:text-indigo-400">🗺️</span>
                  </a>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <a
                  href={`https://wa.me/55${delivery.customerPhone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-center text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  WhatsApp
                </a>
                <button
                  onClick={() => markHubStatus(delivery.hubOrderId, anyConfirmado ? "entregando" : "entregue")}
                  disabled={busy}
                  className="flex-[2] rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {busy ? "Salvando…" : anyConfirmado ? "Saiu pra entrega (todas as paradas)" : "Marcar tudo entregue"}
                </button>
              </div>
            </div>
          );
        })}

        {orders.map((order) => {
          const pay = paymentInfo(order.payment_method, order.pix_paid_at, order.card_paid_at, order.total);
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

              <a
                href={mapsUrl(order.delivery_address)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <span>
                  <span className="font-semibold text-slate-900 dark:text-slate-50">Entregar em: </span>
                  {order.delivery_address}
                  {order.neighborhood_name ? ` — ${order.neighborhood_name}` : ""}
                </span>
                <span className="shrink-0 text-indigo-600 dark:text-indigo-400">🗺️</span>
              </a>

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
              <button
                onClick={() => reportIssue(order.id)}
                className="mt-2 w-full rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 dark:border-red-900 dark:text-red-400"
              >
                🚨 Reportar problema
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
