"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
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
  out_for_delivery_at: string | null;
  order_payment_method: string | null;
  order_pix_paid_at: string | null;
  order_card_paid_at: string | null;
};

type Complaint = {
  id: string;
  category: string;
  description: string;
  status: "aberta" | "em_andamento" | "resolvida";
  owner_reply: string | null;
  owner_reply_at: string | null;
  created_at: string;
};

const COMPLAINT_CATEGORIES: { value: string; label: string }[] = [
  { value: "produto_errado", label: "Veio produto errado" },
  { value: "produto_danificado", label: "Produto danificado" },
  { value: "faltou_item", label: "Faltou item no pedido" },
  { value: "atraso_entrega", label: "Atraso na entrega" },
  { value: "cobranca_errada", label: "Cobrança errada" },
  { value: "atendimento", label: "Problema no atendimento" },
  { value: "outro", label: "Outro" },
];

const COMPLAINT_STATUS_LABEL: Record<Complaint["status"], string> = {
  aberta: "Aberta",
  em_andamento: "Em andamento",
  resolvida: "Resolvida",
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  confirmado: "Confirmado",
  entregando: "A caminho 🛵",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function deliveryEstimateText(row: HubReceiptRow): string | null {
  if (row.status === "entregue" || row.status === "cancelado") return null;
  if (!row.eta_min_minutes && !row.eta_max_minutes) return null;

  if (row.out_for_delivery_at) {
    const base = new Date(row.out_for_delivery_at).getTime();
    const from = row.eta_min_minutes ? new Date(base + row.eta_min_minutes * 60000) : null;
    const to = row.eta_max_minutes ? new Date(base + row.eta_max_minutes * 60000) : null;
    if (from && to) return `Previsão de chegada: entre ${formatTime(from.toISOString())} e ${formatTime(to.toISOString())}`;
    if (to) return `Previsão de chegada: até ${formatTime(to.toISOString())}`;
    return null;
  }

  const min = row.eta_min_minutes;
  const max = row.eta_max_minutes;
  const range = min && max ? (min === max ? `${min} min` : `${min}-${max} min`) : min ? `a partir de ${min} min` : `até ${max} min`;
  return `Chega em ${range} depois que o pedido for confirmado`;
}

function deliveryProgressPercent(row: HubReceiptRow, now: number): number | null {
  if (row.status !== "entregando" || !row.out_for_delivery_at) return null;
  const windowMinutes = row.eta_max_minutes ?? row.eta_min_minutes;
  if (!windowMinutes) return null;
  const start = new Date(row.out_for_delivery_at).getTime();
  const elapsedMs = now - start;
  const totalMs = windowMinutes * 60000;
  return Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100));
}

function paymentBadge(row: HubReceiptRow): string | null {
  if (row.order_payment_method === "pix") return row.order_pix_paid_at ? "✓ Pago (Pix)" : null;
  if (row.order_payment_method === "cartao") return row.order_card_paid_at ? "✓ Pago (cartão)" : null;
  return null;
}

// Uma reclamação por loja/perna do pedido — complaints é uma tabela
// scoped por store_id, então não dá pra abrir "uma reclamação do pedido
// de hub inteiro": o cliente escolhe qual loja, cada bloco tem a própria.
function ComplaintSection({ orderId }: { orderId: string }) {
  const [complaint, setComplaint] = useState<Complaint | null | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState(COMPLAINT_CATEGORIES[0].value);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSupabase()
      .rpc("get_order_complaint", { p_order_id: orderId })
      .then(({ data }) => {
        if (active) setComplaint((data?.[0] as Complaint | undefined) ?? null);
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setError("Conta pra gente o que aconteceu.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: rpcError } = await getSupabase().rpc("file_complaint", {
      p_order_id: orderId,
      p_category: category,
      p_description: description.trim(),
    });
    setSubmitting(false);
    if (rpcError) {
      setError("Não deu pra enviar, tenta de novo em instantes.");
      return;
    }
    setComplaint({
      id: "novo",
      category,
      description: description.trim(),
      status: "aberta",
      owner_reply: null,
      owner_reply_at: null,
      created_at: new Date().toISOString(),
    });
    setShowForm(false);
    setDescription("");
  }

  if (complaint === undefined) return null;

  if (complaint) {
    return (
      <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-slate-900 dark:text-slate-50">Sua reclamação</p>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {COMPLAINT_STATUS_LABEL[complaint.status]}
          </span>
        </div>
        <p className="mt-1 text-slate-600 dark:text-slate-400">{complaint.description}</p>
        {complaint.owner_reply ? (
          <div className="mt-2 rounded-lg bg-white p-2 dark:bg-slate-900">
            <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">Resposta da loja</p>
            <p className="mt-0.5 text-slate-700 dark:text-slate-200">{complaint.owner_reply}</p>
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">A loja ainda não respondeu.</p>
        )}
      </div>
    );
  }

  if (showForm) {
    return (
      <form onSubmit={handleSubmit} className="mt-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">O que aconteceu?</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
        >
          {COMPLAINT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="mt-2 block text-[10px] font-medium text-slate-500 dark:text-slate-400">Conte com mais detalhes</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Descreva o que houve…"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
        />
        {error && <p className="mt-1 text-[10px] text-red-600">{error}</p>}
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {submitting ? "Enviando…" : "Enviar"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <button
      onClick={() => setShowForm(true)}
      className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
    >
      ⚠️ Tive um problema com essa loja
    </button>
  );
}

export default function ReciboHubClient({ rows: initialRows }: { rows: HubReceiptRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const first = rows[0];
  const createdAt = new Date(first.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  // Igual ao recibo de loja única: se qualquer perna do pedido combinado
  // mudar de status enquanto o cliente está com o recibo aberto, atualiza
  // sozinho. Cliente é anônimo (RLS de "orders" não libera select direto
  // pra ele), então verifica de tempos em tempos pela mesma RPC segura,
  // em vez de assinar a tabela.
  const allFinal = rows.every((r) => r.status === "entregue" || r.status === "cancelado");
  useEffect(() => {
    if (allFinal) return;
    const supabase = getSupabase();
    const interval = setInterval(() => {
      supabase.rpc("get_hub_order_receipt", { p_hub_order_id: first.hub_order_id }).then(({ data }) => {
        if (data?.length) setRows(data as HubReceiptRow[]);
      });
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first.hub_order_id, allFinal]);

  const anyEmRota = rows.some((r) => r.status === "entregando");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyEmRota) return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [anyEmRota]);

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
                Pedido dividido em {rows.length} lojas — cada uma prepara e entrega a parte dela, no ritmo dela.
              </p>
            )}
          </div>

          <div className="mt-4 space-y-4 border-t border-dashed border-slate-300 pt-4 dark:border-slate-700">
            {rows.map((r) => {
              const estimate = deliveryEstimateText(r);
              const progress = deliveryProgressPercent(r, now);
              const paid = paymentBadge(r);
              return (
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
                  {paid && <p className="mt-0.5 text-xs text-green-600">{paid}</p>}

                  {estimate && (
                    <p className="mt-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 print:hidden">🕒 {estimate}</p>
                  )}
                  {progress !== null && (
                    <div className="mt-1.5 print:hidden">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all duration-700 dark:bg-blue-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      {progress >= 100 && (
                        <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">Já passou do previsto — deve estar quase chegando</p>
                      )}
                    </div>
                  )}

                  <div className="print:hidden">
                    <ComplaintSection orderId={r.order_id} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 border-t border-dashed border-slate-300 pt-4 dark:border-slate-700">
            <p className="flex justify-between text-base font-semibold text-slate-900 dark:text-slate-50 print:text-slate-900">
              <span>Total</span>
              <span>{formatCurrency(first.hub_total)}</span>
            </p>
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
