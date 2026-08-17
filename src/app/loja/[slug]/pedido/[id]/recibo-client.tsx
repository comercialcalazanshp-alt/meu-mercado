"use client";

import { useEffect, useState } from "react";

type OrderItem = {
  name: string;
  price: number;
  quantity: number;
  line_total?: number;
};

export type OrderReceipt = {
  order_id: string;
  store_name: string;
  store_slug: string;
  customer_name: string;
  items: OrderItem[];
  total: number;
  discount: number;
  coupon_code: string | null;
  delivery_fee: number;
  neighborhood_name: string | null;
  cashback_earned: number;
  cashback_used: number;
  status: string;
  channel: string;
  payment_method: string | null;
  created_at: string;
  out_for_delivery_at: string | null;
  eta_min_minutes: number | null;
  eta_max_minutes: number | null;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function deliveryEstimateText(order: OrderReceipt): string | null {
  if (order.status === "entregue" || order.status === "cancelado") return null;
  if (!order.eta_min_minutes && !order.eta_max_minutes) return null;

  if (order.out_for_delivery_at) {
    const base = new Date(order.out_for_delivery_at).getTime();
    const from = order.eta_min_minutes ? new Date(base + order.eta_min_minutes * 60000) : null;
    const to = order.eta_max_minutes ? new Date(base + order.eta_max_minutes * 60000) : null;
    if (from && to) return `Previsão de chegada: entre ${formatTime(from.toISOString())} e ${formatTime(to.toISOString())}`;
    if (to) return `Previsão de chegada: até ${formatTime(to.toISOString())}`;
    return null;
  }

  const min = order.eta_min_minutes;
  const max = order.eta_max_minutes;
  const range = min && max ? (min === max ? `${min} min` : `${min}-${max} min`) : min ? `a partir de ${min} min` : `até ${max} min`;
  return `Chega em ${range} depois que o pedido for confirmado`;
}

// % da janela de entrega já percorrida, calculada a partir de out_for_delivery_at
// até out_for_delivery_at + eta_max (ou eta_min, se não tiver máximo) — só
// faz sentido enquanto a entrega já saiu e ainda não chegou.
function deliveryProgressPercent(order: OrderReceipt, now: number): number | null {
  if (order.status !== "entregando" || !order.out_for_delivery_at) return null;
  const windowMinutes = order.eta_max_minutes ?? order.eta_min_minutes;
  if (!windowMinutes) return null;
  const start = new Date(order.out_for_delivery_at).getTime();
  const elapsedMs = now - start;
  const totalMs = windowMinutes * 60000;
  return Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100));
}

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  confirmado: "Confirmado",
  entregando: "A caminho 🛵",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ReciboClient({ order }: { order: OrderReceipt }) {
  const subtotal = order.items.reduce(
    (sum, item) => sum + (item.line_total ?? item.price * item.quantity),
    0,
  );
  const createdAt = new Date(order.created_at).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  // Só liga o relógio quando faz sentido (entrega a caminho) — pra não
  // ficar um setInterval rodando à toa numa página estática de recibo já
  // entregue/cancelado.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (order.status !== "entregando") return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [order.status]);
  const progressPercent = deliveryProgressPercent(order, now);

  return (
    <div className="flex flex-1 justify-center bg-slate-50 px-6 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="print:hidden">
          <a
            href={`/loja/${order.store_slug}`}
            className="text-sm text-slate-500 hover:underline dark:text-slate-400"
          >
            ← Voltar à loja
          </a>
          <button
            onClick={() => window.print()}
            className="mt-4 w-full rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 dark:bg-blue-800"
          >
            Imprimir / salvar como PDF
          </button>
        </div>

        <div
          id="recibo-print-area"
          className="mt-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 print:mt-0 print:rounded-none print:border-0 print:p-0"
        >
          <div className="text-center">
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50 print:text-slate-900">
              {order.store_name}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 print:text-slate-500">
              Recibo do pedido · {createdAt}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 print:text-slate-400">
              #{order.order_id.slice(0, 8).toUpperCase()}
            </p>
          </div>

          <div className="mt-4 border-t border-dashed border-slate-300 pt-4 text-sm dark:border-slate-700">
            <p className="text-slate-700 dark:text-slate-300 print:text-slate-700">
              Cliente: {order.customer_name}
            </p>
            <p className="text-slate-500 dark:text-slate-400 print:text-slate-500">
              Status: {STATUS_LABEL[order.status] ?? order.status}
              {order.channel === "balcao" ? " · comprado no balcão" : ""}
            </p>
            {order.payment_method && (
              <p className="text-slate-500 dark:text-slate-400 print:text-slate-500">
                Pagamento: {order.payment_method}
              </p>
            )}
            {deliveryEstimateText(order) && (
              <p className="mt-1 font-medium text-slate-700 dark:text-slate-200 print:text-slate-700">
                🕒 {deliveryEstimateText(order)}
              </p>
            )}
            {progressPercent !== null && (
              <div className="mt-2 print:hidden">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-700 dark:bg-blue-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {progressPercent >= 100 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Já passou do previsto — deve estar quase chegando
                  </p>
                )}
              </div>
            )}
          </div>

          <ul className="mt-4 space-y-1 border-t border-dashed border-slate-300 pt-4 text-sm dark:border-slate-700">
            {order.items.map((item, i) => (
              <li
                key={i}
                className="flex justify-between text-slate-700 dark:text-slate-300 print:text-slate-700"
              >
                <span>
                  {item.quantity}x {item.name}
                </span>
                <span>{formatCurrency(item.line_total ?? item.price * item.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-1 border-t border-dashed border-slate-300 pt-4 text-sm dark:border-slate-700">
            <p className="flex justify-between text-slate-600 dark:text-slate-400 print:text-slate-600">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </p>
            {order.discount > 0 && (
              <p className="flex justify-between text-green-600">
                <span>Desconto{order.coupon_code ? ` (${order.coupon_code})` : ""}</span>
                <span>−{formatCurrency(order.discount)}</span>
              </p>
            )}
            {order.delivery_fee > 0 && (
              <p className="flex justify-between text-slate-600 dark:text-slate-400 print:text-slate-600">
                <span>Entrega{order.neighborhood_name ? ` (${order.neighborhood_name})` : ""}</span>
                <span>{formatCurrency(order.delivery_fee)}</span>
              </p>
            )}
            {order.cashback_used > 0 && (
              <p className="flex justify-between text-green-600">
                <span>Cashback usado</span>
                <span>−{formatCurrency(order.cashback_used)}</span>
              </p>
            )}
            <p className="flex justify-between text-base font-semibold text-slate-900 dark:text-slate-50 print:text-slate-900">
              <span>Total</span>
              <span>{formatCurrency(order.total)}</span>
            </p>
            {order.cashback_earned > 0 && (
              <p className="text-xs text-green-600">
                + {formatCurrency(order.cashback_earned)} de cashback pra próxima compra
              </p>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:hidden,
          .print\\:hidden * {
            visibility: hidden !important;
          }
          #recibo-print-area,
          #recibo-print-area * {
            visibility: visible;
          }
          #recibo-print-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
