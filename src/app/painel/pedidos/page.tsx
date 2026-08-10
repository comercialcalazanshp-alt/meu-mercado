"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type OrderItem = {
  name: string;
  price: number;
  quantity: number;
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

const STATUS_OPTIONS = ["pendente", "confirmado", "entregue", "cancelado"];

const STATUS_STYLES: Record<string, string> = {
  pendente: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  confirmado: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  entregue: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  cancelado: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function Pedidos() {
  const store = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await getSupabase()
        .from("orders")
        .select("id, customer_name, customer_phone, items, total, status, created_at")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false });
      if (active) {
        setOrders(data ?? []);
        setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [store.id]);

  async function updateStatus(id: string, status: string) {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    await getSupabase().from("orders").update({ status }).eq("id", id);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Pedidos</h1>

      {loading && <p className="mt-4 text-sm text-slate-500">Carregando…</p>}
      {!loading && orders.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">Nenhum pedido recebido ainda.</p>
      )}

      <div className="mt-4 space-y-3">
        {orders.map((order) => (
          <div
            key={order.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-50">
                  {order.customer_name}
                </p>
                <a
                  href={`https://wa.me/55${order.customer_phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-900 underline dark:text-blue-400"
                >
                  {order.customer_phone}
                </a>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {formatDate(order.created_at)}
                </p>
              </div>
              <select
                value={order.status}
                onChange={(e) => updateStatus(order.id, e.target.value)}
                className={`rounded-full border-0 px-3 py-1 text-xs font-medium ${STATUS_STYLES[order.status] ?? ""}`}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
              {order.items.map((item, i) => (
                <li key={i} className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>
                    {item.quantity}x {item.name}
                  </span>
                  <span>{formatCurrency(item.price * item.quantity)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-right font-semibold text-slate-900 dark:text-slate-50">
              Total: {formatCurrency(order.total)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
