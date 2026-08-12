"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type OrderItem = {
  name: string;
  price: number;
  quantity: number;
  line_total?: number;
};

type Order = {
  id: string;
  customer_name: string;
  customer_phone: string;
  items: OrderItem[];
  total: number;
  status: string;
  created_at: string;
  coupon_code: string | null;
  discount_amount: number;
  neighborhood_name: string | null;
  delivery_fee: number;
  channel: string;
  payment_method: string | null;
  pix_paid_at: string | null;
  card_paid_at: string | null;
  card_last_digits: string | null;
  seen_at: string | null;
  internal_note: string | null;
};

const STATUS_OPTIONS = ["pendente", "confirmado", "entregando", "entregue", "cancelado"];

const STATUS_LABELS: Record<string, string> = {
  pendente: "pendente",
  confirmado: "confirmado",
  entregando: "a caminho",
  entregue: "entregue",
  cancelado: "cancelado",
};

const STATUS_STYLES: Record<string, string> = {
  pendente: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  confirmado: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  entregando: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  entregue: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  cancelado: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

const CHANNEL_LABELS: Record<string, string> = {
  site: "Site",
  balcao: "Balcão",
  assinatura: "Assinatura",
};

const STALLED_MINUTES = 20;
const WHATSAPP_MESSAGES: Record<string, string> = {
  entregando: "Oi! Seu pedido já saiu e está a caminho. 🚴",
  entregue: "Oi! Seu pedido foi entregue, muito obrigado pela compra! 🙏",
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dateGroupLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Hoje";
  if (sameDay(date, yesterday)) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function minutesSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function paymentBadge(order: Order): { text: string; className: string } | null {
  if (order.payment_method === "pix") {
    return order.pix_paid_at
      ? { text: "✓ Pix pago", className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" }
      : { text: "⏳ Aguardando Pix", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" };
  }
  if (order.payment_method === "cartao") {
    return order.card_paid_at
      ? {
          text: `✓ Cartão${order.card_last_digits ? ` •••• ${order.card_last_digits}` : ""} pago`,
          className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
        }
      : { text: "⏳ Aguardando cartão", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" };
  }
  return null;
}

function orderSummaryText(order: Order) {
  const lines = order.items.map(
    (item) => `${item.quantity}x ${item.name} — ${formatCurrency(item.line_total ?? item.price * item.quantity)}`,
  );
  return `Pedido de ${order.customer_name}\n${lines.join("\n")}\nTotal: ${formatCurrency(order.total)}`;
}

export default function Pedidos() {
  const store = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [channelFilter, setChannelFilter] = useState<string>("todos");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<OrderItem[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [, forceTick] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await getSupabase()
        .from("orders")
        .select(
          "id, customer_name, customer_phone, items, total, status, created_at, coupon_code, discount_amount, neighborhood_name, delivery_fee, channel, payment_method, pix_paid_at, card_paid_at, card_last_digits, seen_at, internal_note",
        )
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

  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  async function updateStatus(id: string, status: string) {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    await getSupabase().from("orders").update({ status }).eq("id", id);
  }

  async function markSeen(order: Order) {
    if (order.seen_at) return;
    const now = new Date().toISOString();
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, seen_at: now } : o)));
    await getSupabase().from("orders").update({ seen_at: now }).eq("id", order.id);
  }

  function avisarWhatsapp(order: Order, status: string) {
    const message = WHATSAPP_MESSAGES[status];
    if (!message) return;
    window.open(
      `https://wa.me/55${order.customer_phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
      "_blank",
    );
  }

  async function handleStatusChange(order: Order, status: string) {
    await updateStatus(order.id, status);
    avisarWhatsapp(order, status);
  }

  function copySummary(order: Order) {
    navigator.clipboard.writeText(orderSummaryText(order));
  }

  function startEdit(order: Order) {
    setEditingId(order.id);
    setEditItems(order.items.map((i) => ({ ...i })));
  }

  function editQuantity(index: number, quantity: number) {
    setEditItems((prev) => prev.map((item, i) => (i === index ? { ...item, quantity: Math.max(0, quantity) } : item)));
  }

  function removeEditItem(index: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveEdit(order: Order) {
    const cleanItems = editItems
      .filter((i) => i.quantity > 0)
      .map((i) => ({ ...i, line_total: i.price * i.quantity }));
    const newTotal = cleanItems.reduce((sum, i) => sum + (i.line_total ?? 0), 0) + order.delivery_fee - order.discount_amount;
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, items: cleanItems, total: newTotal } : o)),
    );
    setEditingId(null);
    await getSupabase().from("orders").update({ items: cleanItems, total: newTotal }).eq("id", order.id);
  }

  async function saveNote(order: Order) {
    const note = (noteDrafts[order.id] ?? order.internal_note ?? "").trim();
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, internal_note: note || null } : o)));
    await getSupabase().from("orders").update({ internal_note: note || null }).eq("id", order.id);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setOrders((prev) => prev.map((o) => (ids.includes(o.id) ? { ...o, status: "confirmado" } : o)));
    setSelectedIds(new Set());
    await getSupabase().from("orders").update({ status: "confirmado" }).in("id", ids);
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "todos" && o.status !== statusFilter) return false;
      if (channelFilter !== "todos" && o.channel !== channelFilter) return false;
      if (term && !o.customer_name.toLowerCase().includes(term) && !o.customer_phone.includes(term)) return false;
      return true;
    });
  }, [orders, statusFilter, channelFilter, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.status === "pendente" && b.status === "pendente") {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (a.status === "pendente") return -1;
      if (b.status === "pendente") return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [filtered]);

  const groups = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const order of sorted) {
      const label = dateGroupLabel(order.created_at);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(order);
    }
    return Array.from(map.entries());
  }, [sorted]);

  const todayOrders = useMemo(() => orders.filter((o) => dateGroupLabel(o.created_at) === "Hoje"), [orders]);
  const todayRevenue = todayOrders
    .filter((o) => o.status !== "cancelado")
    .reduce((sum, o) => sum + o.total, 0);
  const todayPending = todayOrders.filter((o) => o.status === "pendente").length;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { todos: orders.length };
    for (const s of STATUS_OPTIONS) counts[s] = orders.filter((o) => o.status === s).length;
    return counts;
  }, [orders]);

  function printToday() {
    window.print();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Pedidos</h1>
        <button
          onClick={printToday}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          🖨️ Imprimir lista de hoje
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900 print:hidden">
        <p className="text-slate-600 dark:text-slate-400">
          Hoje: <span className="font-semibold text-slate-900 dark:text-slate-50">{todayOrders.length} pedidos</span>
        </p>
        <p className="text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-900 dark:text-slate-50">{formatCurrency(todayRevenue)}</span> em vendas
        </p>
        {todayPending > 0 && (
          <p className="text-amber-700 dark:text-amber-400">
            <span className="font-semibold">{todayPending}</span> aguardando ação
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 print:hidden">
        {["todos", ...STATUS_OPTIONS].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              statusFilter === s
                ? "bg-blue-900 text-white dark:bg-blue-700"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {s === "todos" ? "Todos" : STATUS_LABELS[s]} ({statusCounts[s] ?? 0})
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 print:hidden">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Buscar por nome ou telefone…"
          className="flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        >
          <option value="todos">Todos os canais</option>
          <option value="site">Site</option>
          <option value="balcao">Balcão</option>
          <option value="assinatura">Assinatura</option>
        </select>
      </div>

      {selectedIds.size > 0 && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-sm dark:bg-blue-900/30 print:hidden">
          <span className="text-blue-800 dark:text-blue-300">{selectedIds.size} selecionado(s)</span>
          <button
            onClick={confirmSelected}
            className="rounded-lg bg-blue-900 px-3 py-1 text-xs font-semibold text-white dark:bg-blue-700"
          >
            Confirmar selecionados
          </button>
        </div>
      )}

      {loading && <p className="mt-4 text-sm text-slate-500">Carregando…</p>}
      {!loading && sorted.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">Nenhum pedido encontrado.</p>
      )}

      <div className="mt-4 space-y-6 print:mt-2">
        {groups.map(([label, groupOrders]) => (
          <div key={label}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {label}
            </p>
            <div className="space-y-3">
              {groupOrders.map((order) => {
                const stalled = order.status === "pendente" && minutesSince(order.created_at) > STALLED_MINUTES;
                const badge = paymentBadge(order);
                const isEditing = editingId === order.id;
                return (
                  <div
                    key={order.id}
                    onClick={() => markSeen(order)}
                    className={`rounded-xl border bg-white p-4 dark:bg-slate-900 print:break-inside-avoid ${
                      stalled
                        ? "border-red-300 dark:border-red-800"
                        : "border-slate-200 dark:border-slate-800"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        {order.status === "pendente" && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(order.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleSelect(order.id)}
                            className="mt-1.5 print:hidden"
                          />
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            {!order.seen_at && (
                              <span className="h-2 w-2 rounded-full bg-blue-600 print:hidden" title="Não visto" />
                            )}
                            <p className="font-semibold text-slate-900 dark:text-slate-50">
                              {order.customer_name}
                            </p>
                            {order.channel === "assinatura" && (
                              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-400">
                                🔁 Assinatura
                              </span>
                            )}
                            {order.channel === "balcao" && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                Balcão
                              </span>
                            )}
                          </div>
                          <a
                            href={`https://wa.me/55${order.customer_phone.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm text-blue-900 underline dark:text-blue-400"
                          >
                            {order.customer_phone}
                          </a>
                          <p className="text-xs text-slate-400 dark:text-slate-500">
                            {formatTime(order.created_at)}
                            {stalled && (
                              <span className="ml-2 font-medium text-red-600 dark:text-red-400">
                                ⏱️ parado há {minutesSince(order.created_at)}min
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <select
                        value={order.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleStatusChange(order, e.target.value)}
                        className={`rounded-full border-0 px-3 py-1 text-xs font-medium print:hidden ${STATUS_STYLES[order.status] ?? ""}`}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <span className={`hidden rounded-full px-3 py-1 text-xs font-medium print:inline-block ${STATUS_STYLES[order.status] ?? ""}`}>
                        {STATUS_LABELS[order.status]}
                      </span>
                    </div>

                    {!isEditing ? (
                      <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                        {order.items.map((item, i) => (
                          <li key={i} className="flex justify-between text-slate-600 dark:text-slate-400">
                            <span>
                              {item.quantity}x {item.name}
                            </span>
                            <span>{formatCurrency(item.line_total ?? item.price * item.quantity)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                        {editItems.map((item, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-sm">
                            <span className="flex-1 text-slate-600 dark:text-slate-400">{item.name}</span>
                            <input
                              type="number"
                              min={0}
                              value={item.quantity}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => editQuantity(i, Number(e.target.value))}
                              className="w-16 rounded border border-slate-300 px-2 py-0.5 text-center dark:border-slate-700 dark:bg-slate-900"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeEditItem(i);
                              }}
                              className="text-red-600 dark:text-red-400"
                            >
                              remover
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              saveEdit(order);
                            }}
                            className="rounded-lg bg-blue-900 px-3 py-1 text-xs font-semibold text-white dark:bg-blue-700"
                          >
                            Salvar itens
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(null);
                            }}
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {order.coupon_code && (
                      <p className="mt-2 text-right text-sm text-green-600">
                        Cupom {order.coupon_code}: −{formatCurrency(order.discount_amount)}
                      </p>
                    )}
                    <p className="mt-1 text-right text-sm text-slate-500 dark:text-slate-400">
                      {order.neighborhood_name
                        ? `Entrega: ${order.neighborhood_name} (${formatCurrency(order.delivery_fee)})`
                        : "Retirar na loja"}
                    </p>
                    <p className="mt-1 text-right font-semibold text-slate-900 dark:text-slate-50">
                      Total: {formatCurrency(order.total)}
                    </p>

                    {badge && (
                      <div className="mt-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
                          {badge.text}
                        </span>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 print:hidden dark:border-slate-800">
                      {!isEditing && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(order);
                          }}
                          className="text-xs text-slate-500 underline dark:text-slate-400"
                        >
                          Editar itens
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copySummary(order);
                        }}
                        className="text-xs text-slate-500 underline dark:text-slate-400"
                      >
                        Copiar resumo
                      </button>
                    </div>

                    <textarea
                      value={noteDrafts[order.id] ?? order.internal_note ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [order.id]: e.target.value }))}
                      onBlur={() => saveNote(order)}
                      placeholder="Nota interna (só você vê)…"
                      rows={1}
                      className="mt-2 w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600 placeholder:text-slate-400 print:hidden dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
