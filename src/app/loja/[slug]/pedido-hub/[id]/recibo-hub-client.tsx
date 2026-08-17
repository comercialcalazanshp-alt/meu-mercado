"use client";

import { formatCurrency } from "@/lib/storefront-pricing";

export type HubReceiptRow = {
  hub_order_id: string;
  hub_store_name: string;
  customer_name: string;
  customer_phone: string;
  hub_total: number;
  payment_method: string | null;
  pix_qr_code_text: string | null;
  pix_qr_code_image: string | null;
  pix_paid_at: string | null;
  card_paid_at: string | null;
  created_at: string;
  order_id: string;
  store_id: string;
  store_name: string;
  store_brand_color: string;
  items: { name: string; price: number; quantity: number; line_total?: number }[];
  store_total: number;
  discount: number;
  delivery_fee: number;
  neighborhood_name: string | null;
  status: string;
  eta_min_minutes: number | null;
  eta_max_minutes: number | null;
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  confirmado: "Confirmado",
  entregando: "A caminho 🛵",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export default function ReciboHubClient({ rows }: { rows: HubReceiptRow[] }) {
  const first = rows[0];
  const createdAt = new Date(first.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="flex flex-1 justify-center bg-slate-50 px-6 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="print:hidden">
          <button
            onClick={() => window.print()}
            className="mt-4 w-full rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 dark:bg-blue-800"
          >
            Imprimir / salvar como PDF
          </button>
        </div>

        <div
          id="recibo-hub-print-area"
          className="mt-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 print:mt-0 print:rounded-none print:border-0 print:p-0"
        >
          <div className="text-center">
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50 print:text-slate-900">{first.hub_store_name}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 print:text-slate-500">Recibo do pedido · {createdAt}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 print:text-slate-400">
              #{first.hub_order_id.slice(0, 8).toUpperCase()}
            </p>
          </div>

          <div className="mt-4 border-t border-dashed border-slate-300 pt-4 text-sm dark:border-slate-700">
            <p className="text-slate-700 dark:text-slate-300 print:text-slate-700">Cliente: {first.customer_name}</p>
            {rows.length > 1 && (
              <p className="text-slate-500 dark:text-slate-400 print:text-slate-500">
                Pedido dividido em {rows.length} lojas — cada uma prepara a parte dela.
              </p>
            )}
          </div>

          <div className="mt-4 space-y-4 border-t border-dashed border-slate-300 pt-4 dark:border-slate-700">
            {rows.map((r) => (
              <div key={r.order_id}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-50 print:text-slate-900">{r.store_name}</p>
                  <span className="text-xs text-slate-500">{STATUS_LABEL[r.status] ?? r.status}</span>
                </div>
                <ul className="mt-1 space-y-1 text-sm">
                  {r.items.map((item, i) => (
                    <li key={i} className="flex justify-between text-slate-700 dark:text-slate-300 print:text-slate-700">
                      <span>{item.quantity}x {item.name}</span>
                      <span>{formatCurrency(item.line_total ?? item.price * item.quantity)}</span>
                    </li>
                  ))}
                </ul>
                {r.discount > 0 && (
                  <p className="flex justify-between text-xs text-green-600">
                    <span>Desconto</span>
                    <span>−{formatCurrency(r.discount)}</span>
                  </p>
                )}
                {r.delivery_fee > 0 && (
                  <p className="flex justify-between text-xs text-slate-500">
                    <span>Entrega{r.neighborhood_name ? ` (${r.neighborhood_name})` : ""}</span>
                    <span>{formatCurrency(r.delivery_fee)}</span>
                  </p>
                )}
                <p className="mt-1 flex justify-between text-sm font-semibold text-slate-900 dark:text-slate-50 print:text-slate-900">
                  <span>Subtotal</span>
                  <span>{formatCurrency(r.store_total)}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-dashed border-slate-300 pt-4 dark:border-slate-700">
            <p className="flex justify-between text-base font-semibold text-slate-900 dark:text-slate-50 print:text-slate-900">
              <span>Total</span>
              <span>{formatCurrency(first.hub_total)}</span>
            </p>
            {first.pix_paid_at && <p className="mt-1 text-xs text-green-600">✓ Pix pago</p>}
            {first.card_paid_at && <p className="mt-1 text-xs text-green-600">✓ Cartão pago</p>}
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
          #recibo-hub-print-area,
          #recibo-hub-print-area * {
            visibility: visible;
          }
          #recibo-hub-print-area {
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
