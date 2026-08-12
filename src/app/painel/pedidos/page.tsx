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
  cancel_reason: string | null;
  refund_resolved: boolean;
};

type Product = {
  id: string;
  name: string;
  price: number;
};

const CANCEL_REASONS = [
  "Sem estoque",
  "Cliente desistiu",
  "Endereço errado",
  "Demora demais",
  "Outro motivo",
];

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
  const [products, setProducts] = useState<Product[]>([]);
  const [addProductId, setAddProductId] = useState<Record<string, string>>({});
  const [highValueThreshold, setHighValueThreshold] = useState(150);
  const [compactMode, setCompactMode] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [, forceTick] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem("pedidos-valor-alto");
    if (saved) setHighValueThreshold(Number(saved));
    const compact = localStorage.getItem("pedidos-modo-compacto");
    if (compact) setCompactMode(compact === "1");
  }, []);

  function toggleCompactMode() {
    setCompactMode((prev) => {
      const next = !prev;
      localStorage.setItem("pedidos-modo-compacto", next ? "1" : "0");
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await getSupabase()
        .from("orders")
        .select(
          "id, customer_name, customer_phone, items, total, status, created_at, coupon_code, discount_amount, neighborhood_name, delivery_fee, channel, payment_method, pix_paid_at, card_paid_at, card_last_digits, seen_at, internal_note, cancel_reason, refund_resolved",
        )
        .eq("store_id", store.id)
        .order("created_at", { ascending: false });
      if (active) {
        setOrders(data ?? []);
        setLoading(false);
      }
    }

    load();

    getSupabase()
      .from("products")
      .select("id, name, price")
      .eq("store_id", store.id)
      .order("name")
      .then(({ data }) => {
        if (active) setProducts(data ?? []);
      });

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
    const receiptUrl = `${window.location.origin}/loja/${store.slug}/pedido/${order.id}`;
    const fullMessage = `${message}\n\nAcompanhe seu pedido: ${receiptUrl}`;
    window.open(
      `https://wa.me/55${order.customer_phone.replace(/\D/g, "")}?text=${encodeURIComponent(fullMessage)}`,
      "_blank",
    );
  }

  async function handleStatusChange(order: Order, status: string) {
    if (status === "cancelado") {
      const reason = window.prompt(
        `Por que está cancelando o pedido de ${order.customer_name}?\n\n${CANCEL_REASONS.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\nDigite o número ou escreva o motivo:`,
      );
      if (reason === null) return;
      const picked = CANCEL_REASONS[Number(reason) - 1] ?? reason.trim();
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status, cancel_reason: picked || null } : o)),
      );
      await getSupabase()
        .from("orders")
        .update({ status, cancel_reason: picked || null })
        .eq("id", order.id);
      return;
    }
    await updateStatus(order.id, status);
    avisarWhatsapp(order, status);
  }

  async function markRefundResolved(order: Order) {
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, refund_resolved: true } : o)));
    await getSupabase().from("orders").update({ refund_resolved: true }).eq("id", order.id);
  }

  function copySummary(order: Order) {
    navigator.clipboard.writeText(orderSummaryText(order));
  }

  function printLabel(order: Order) {
    const win = window.open("", "_blank", "width=380,height=500");
    if (!win) return;
    const itemsHtml = order.items
      .map(
        (item) =>
          `<tr><td>${item.quantity}x ${item.name}</td><td style="text-align:right">${formatCurrency(item.line_total ?? item.price * item.quantity)}</td></tr>`,
      )
      .join("");
    win.document.write(`
      <html><head><title>Etiqueta - ${order.customer_name}</title>
      <style>
        body{font-family:sans-serif;padding:16px;font-size:14px;}
        h2{margin:0 0 4px;} table{width:100%;border-collapse:collapse;margin-top:8px;}
        td{padding:2px 0;border-top:1px solid #ddd;} .total{font-weight:bold;text-align:right;margin-top:8px;}
      </style></head><body>
      <h2>${order.customer_name}</h2>
      <p>${order.customer_phone}</p>
      <p>${order.neighborhood_name ? `Entrega: ${order.neighborhood_name}` : "Retirar na loja"}</p>
      <table>${itemsHtml}</table>
      <p class="total">Total: ${formatCurrency(order.total)}</p>
      <script>window.print();</script>
      </body></html>
    `);
    win.document.close();
  }

  function exportCsv(rows: Order[]) {
    const header = ["Data", "Cliente", "Telefone", "Itens", "Total", "Status", "Pagamento", "Canal"];
    const lines = rows.map((o) => {
      const items = o.items.map((i) => `${i.quantity}x ${i.name}`).join("; ");
      const pay = o.payment_method ?? "combinar";
      return [
        new Date(o.created_at).toLocaleString("pt-BR"),
        o.customer_name,
        o.customer_phone,
        items,
        o.total.toFixed(2),
        STATUS_LABELS[o.status] ?? o.status,
        pay,
        CHANNEL_LABELS[o.channel] ?? o.channel,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function updateThreshold(value: number) {
    setHighValueThreshold(value);
    localStorage.setItem("pedidos-valor-alto", String(value));
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

  function addEditItem(orderId: string) {
    const productId = addProductId[orderId];
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setEditItems((prev) => {
      const existing = prev.find((i) => i.name === product.name);
      if (existing) {
        return prev.map((i) => (i.name === product.name ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { name: product.name, price: product.price, quantity: 1 }];
    });
    setAddProductId((prev) => ({ ...prev, [orderId]: "" }));
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

  function selectAllPending(visibleOrders: Order[]) {
    setSelectedIds(new Set(visibleOrders.filter((o) => o.status === "pendente").map((o) => o.id)));
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

  const possibleDuplicateIds = useMemo(() => {
    const flagged = new Set<string>();
    const byPhone = new Map<string, Order[]>();
    for (const o of orders) {
      if (o.status === "cancelado") continue;
      if (!byPhone.has(o.customer_phone)) byPhone.set(o.customer_phone, []);
      byPhone.get(o.customer_phone)!.push(o);
    }
    for (const phoneOrders of byPhone.values()) {
      for (let i = 0; i < phoneOrders.length; i++) {
        for (let j = i + 1; j < phoneOrders.length; j++) {
          const diffMinutes =
            Math.abs(new Date(phoneOrders[i].created_at).getTime() - new Date(phoneOrders[j].created_at).getTime()) /
            60000;
          if (diffMinutes <= 10) {
            flagged.add(phoneOrders[i].id);
            flagged.add(phoneOrders[j].id);
          }
        }
      }
    }
    return flagged;
  }, [orders]);

  const firstOrderIdByPhone = useMemo(() => {
    const map = new Map<string, string>();
    const earliest = new Map<string, string>();
    for (const o of orders) {
      const current = earliest.get(o.customer_phone);
      if (!current || o.created_at < current) {
        earliest.set(o.customer_phone, o.created_at);
        map.set(o.customer_phone, o.id);
      }
    }
    return map;
  }, [orders]);

  function printToday() {
    window.print();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Pedidos</h1>
        <div className="flex gap-2">
          <button
            onClick={toggleCompactMode}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              compactMode
                ? "border-blue-900 bg-blue-900 text-white dark:border-blue-700 dark:bg-blue-700"
                : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"
            }`}
          >
            📋 Modo compacto
          </button>
          <button
            onClick={() => exportCsv(sorted)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            📊 Exportar planilha
          </button>
          <button
            onClick={printToday}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            🖨️ Imprimir lista de hoje
          </button>
        </div>
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
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          💰 Valor alto a partir de
          <input
            type="number"
            value={highValueThreshold}
            onChange={(e) => updateThreshold(Number(e.target.value))}
            className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
        </label>
      </div>

      {statusCounts.pendente > 0 && (
        <button
          onClick={() => selectAllPending(sorted)}
          className="mt-2 text-xs text-blue-900 underline print:hidden dark:text-blue-400"
        >
          Selecionar todos os pendentes visíveis
        </button>
      )}

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
                const stalled =
                  (order.status === "pendente" || order.status === "confirmado") &&
                  minutesSince(order.created_at) > STALLED_MINUTES;
                const badge = paymentBadge(order);
                const isEditing = editingId === order.id;
                const isExpanded = !compactMode || expandedIds.has(order.id);
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
                            {firstOrderIdByPhone.get(order.customer_phone) === order.id && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                                🆕 Primeira compra
                              </span>
                            )}
                            {order.total >= highValueThreshold && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                                💰 Valor alto
                              </span>
                            )}
                            {possibleDuplicateIds.has(order.id) && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
                                ⚠️ Pode ser duplicado
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

                    {compactMode && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(order.id);
                        }}
                        className="mt-1 text-xs text-blue-900 underline print:hidden dark:text-blue-400"
                      >
                        {isExpanded ? "▴ ver menos" : "▾ ver detalhes"}
                      </button>
                    )}

                    {!isExpanded ? (
                      <p className="mt-1 text-right font-semibold text-slate-900 dark:text-slate-50">
                        Total: {formatCurrency(order.total)}
                      </p>
                    ) : (
                      <>
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
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={addProductId[order.id] ?? ""}
                            onChange={(e) => setAddProductId((prev) => ({ ...prev, [order.id]: e.target.value }))}
                            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                          >
                            <option value="">+ Adicionar produto…</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} — {formatCurrency(p.price)}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => addEditItem(order.id)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                          >
                            Adicionar
                          </button>
                        </div>
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

                    {order.status === "cancelado" && order.cancel_reason && (
                      <p className="mt-2 text-right text-xs text-slate-500 dark:text-slate-400">
                        Motivo: {order.cancel_reason}
                      </p>
                    )}

                    {badge && (
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
                          {badge.text}
                        </span>
                      </div>
                    )}

                    {order.status === "cancelado" &&
                      (order.pix_paid_at || order.card_paid_at) &&
                      !order.refund_resolved && (
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
                            💸 Reembolso pendente
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markRefundResolved(order);
                            }}
                            className="text-xs text-slate-500 underline dark:text-slate-400"
                          >
                            marcar devolvido
                          </button>
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          printLabel(order);
                        }}
                        className="text-xs text-slate-500 underline dark:text-slate-400"
                      >
                        🖨️ Etiqueta
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSearch(order.customer_phone);
                        }}
                        className="text-xs text-slate-500 underline dark:text-slate-400"
                      >
                        Ver histórico desse cliente
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
                      </>
                    )}
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
