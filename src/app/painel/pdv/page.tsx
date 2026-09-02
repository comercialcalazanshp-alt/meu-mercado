"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { buildReceiptHtml, printHtml } from "@/lib/receipt";
import {
  cacheProducts,
  getCachedProducts,
  cacheKits,
  getCachedKits,
  queueSale,
  getPendingSales,
  removePendingSale,
  markPendingSaleFailed,
  isOfflineCapable,
  type PendingSale,
} from "@/lib/pdv-offline";

type Product = {
  id: string;
  name: string;
  price: number;
  stock: number;
  barcode: string | null;
  sold_by_weight: boolean;
  promo_buy_qty: number | null;
  promo_pay_qty: number | null;
  price_wholesale: number | null;
  wholesale_min_qty: number | null;
  price_fiado: number | null;
  on_offer: boolean;
  offer_price: number | null;
  offer_ends_at: string | null;
};

type KitOption = {
  id: string;
  name: string;
  price: number;
  buildable: number;
};

type CartLine = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  stock: number;
  soldByWeight: boolean;
  isKit?: boolean;
  promoBuyQty?: number | null;
  promoPayQty?: number | null;
  priceWholesale?: number | null;
  wholesaleMinQty?: number | null;
  priceFiado?: number | null;
  onOffer?: boolean;
  offerPrice?: number | null;
  offerEndsAt?: string | null;
};

type RecentSale = {
  id: string;
  total: number;
  payment_method: string | null;
  payment_split: { method: string; amount: number }[] | null;
  created_at: string;
};

type CreditCustomer = {
  id: string;
  name: string;
  phone: string;
};

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao: "Cartão",
  fiado: "Crediário",
  dividido: "Dividido",
};

type PaymentMethod = "dinheiro" | "pix" | "cartao" | "fiado";

const CASH_BUTTONS = [5, 10, 20, 50, 100, 200];

const SHORTCUTS: [string, string][] = [
  ["F1", "Mostrar esses atalhos"],
  ["F2", "Focar na busca / código de barras"],
  ["F3", "Forma de pagamento: Dinheiro"],
  ["F4", "Forma de pagamento: Pix"],
  ["F5", "Forma de pagamento: Cartão"],
  ["F6", "Forma de pagamento: Crediário"],
  ["F7", "Finalizar venda"],
  ["F8", "Cancelar venda / limpar carrinho"],
  ["F9", "Buscar cliente do crediário"],
  ["F10", "Dividir pagamento (ligar/desligar)"],
];

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatQty(line: { quantity: number; soldByWeight: boolean }) {
  return line.soldByWeight ? `${line.quantity.toFixed(3)} kg` : String(line.quantity);
}

// Espelha a ordem de prioridade de preço da função pdv_sale() no banco
// (schema-v45.sql) — sem isso a tela mostra o preço de tabela mesmo quando a
// venda vai ser cobrada por um preço diferente (oferta, atacado, fiado,
// combo), e o troco/soma do pagamento dividido calculado na hora fica errado.
function pdvLineTotal(
  line: CartLine,
  quantity: number,
  paymentMethod: PaymentMethod | null,
  isSplit: boolean,
): number {
  if (line.isKit) return line.price * quantity;
  if (!isSplit && paymentMethod === "fiado" && line.priceFiado != null) {
    return line.priceFiado * quantity;
  }
  if (line.onOffer && line.offerPrice != null && (!line.offerEndsAt || new Date(line.offerEndsAt) > new Date())) {
    return line.offerPrice * quantity;
  }
  if (line.priceWholesale != null && line.wholesaleMinQty != null && quantity >= line.wholesaleMinQty) {
    return line.priceWholesale * quantity;
  }
  if (!line.soldByWeight && line.promoBuyQty && line.promoPayQty && quantity >= line.promoBuyQty) {
    const fullSets = Math.floor(quantity / line.promoBuyQty);
    const remainder = quantity - fullSets * line.promoBuyQty;
    return (fullSets * line.promoPayQty + remainder) * line.price;
  }
  return line.price * quantity;
}

// "500," = 500 gramas (produto por peso) · "5*" = 5 unidades — digitado antes de escolher o produto.
function parseQtyPrefix(raw: string): { qty: number; mode: "peso" | "unidade"; rest: string } | null {
  const m = raw.match(/^(\d+)\s*([,*])\s*(.*)$/);
  if (!m) return null;
  const digits = Number(m[1]);
  if (!digits || digits <= 0) return null;
  if (m[2] === ",") return { qty: round3(digits / 1000), mode: "peso", rest: m[3] };
  return { qty: digits, mode: "unidade", rest: m[3] };
}

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1400;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {
    // sem suporte a Web Audio — só perde o bipe
  }
}

// Ícones pequenos e consistentes (sem lib nova) pra substituir emoji solto em
// botão/estado — mesma linguagem visual em toda a tela.
function IconSearch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconKeyboard({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 14h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconRepeat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 14-5.2M20 4v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12a8 8 0 0 1-14 5.2M4 20v-4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconSplit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 6h5l6 12h5M4 18h5l2.2-4.4M15.5 6H20M17.5 4l2.5 2-2.5 2M17.5 20l2.5-2-2.5-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconPrinter({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 9V3h12v6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <rect x="4" y="9" width="16" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 14h12v7H6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function IconWarning({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3.5 2.5 20h19L12 3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4.5M12 17.2v.05" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12.3l2.6 2.6L16.3 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconX({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconCart({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20.5 8H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20.5" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20.5" r="1.4" fill="currentColor" />
    </svg>
  );
}
function IconBanknote({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 9v.01M18 15v.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function IconPix({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M8.5 4.5 4.5 8.5a2.8 2.8 0 0 0 0 4l4 4a2.8 2.8 0 0 0 4 0l4-4a2.8 2.8 0 0 0 0-4l-4-4a2.8 2.8 0 0 0-4 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 9.2 12 12l3-2.8M9 14.8 12 12l3 2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCard({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M2.5 9.5h19" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconBook({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 5.2c0-.7.6-1.2 1.3-1.1 2 .2 4.3.9 6.7 2.4 2.4-1.5 4.7-2.2 6.7-2.4.7-.1 1.3.4 1.3 1.1v13c0 .7-.6 1.2-1.3 1.1-2-.2-4.3-.8-6.7-2.3-2.4 1.5-4.7 2.1-6.7 2.3-.7.1-1.3-.4-1.3-1.1v-13Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 6.5v13" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function IconScale({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3v3M6 6h12M6 6 3.5 11a2.5 2.5 0 0 0 5 0L6 6ZM18 6l-2.5 5a2.5 2.5 0 0 0 5 0L18 6Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 21h8M12 15v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function IconTrash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 7h16M9 7V4.8c0-.4.4-.8.9-.8h4.2c.5 0 .9.4.9.8V7M6.5 7l.7 12.3c0 .9.8 1.7 1.7 1.7h6.2c.9 0 1.7-.8 1.7-1.7L17.5 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Pdv() {
  const store = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [kits, setKits] = useState<KitOption[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    total: number;
    subtotal: number;
    discountAmount: number;
    troco: number | null;
    items: CartLine[];
    method: PaymentMethod | "dividido";
    split: { method: PaymentMethod; amount: number }[] | null;
    offline: boolean;
  } | null>(null);

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddBarcode, setQuickAddBarcode] = useState("");
  const [quickAddPrice, setQuickAddPrice] = useState("");
  const [quickAddStock, setQuickAddStock] = useState("");
  const [quickAddSoldByWeight, setQuickAddSoldByWeight] = useState(false);
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [lastSale, setLastSale] = useState<CartLine[] | null>(null);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [caixaAberto, setCaixaAberto] = useState<boolean | null>(null);
  const [sellerEmail, setSellerEmail] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [creditSearch, setCreditSearch] = useState("");
  const [creditMatches, setCreditMatches] = useState<CreditCustomer[]>([]);
  const [creditCustomerId, setCreditCustomerId] = useState<string | null>(null);
  const creditSearchRef = useRef<HTMLInputElement>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [splitPayments, setSplitPayments] = useState<{ method: PaymentMethod; amount: string }[]>([
    { method: "dinheiro", amount: "" },
    { method: "fiado", amount: "" },
  ]);
  const [discountType, setDiscountType] = useState<"valor" | "percentual">("valor");
  const [discountValue, setDiscountValue] = useState("");

  // Suporte a venda sem internet: se a conexão cair, o PDV continua
  // funcionando com o catálogo salvo localmente (IndexedDB) e guarda as
  // vendas numa fila pra sincronizar assim que a conexão voltar.
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSaleCount, setPendingSaleCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const offlineCapable = isOfflineCapable();

  async function loadProducts() {
    setLoadingProducts(true);
    const { data, error: fetchError } = await getSupabase()
      .from("products")
      .select(
        "id, name, price, stock, barcode, sold_by_weight, promo_buy_qty, promo_pay_qty, price_wholesale, wholesale_min_qty, price_fiado, on_offer, offer_price, offer_ends_at",
      )
      .eq("store_id", store.id)
      .order("name", { ascending: true });
    if (data) {
      setProducts(data);
      if (offlineCapable) cacheProducts(store.id, data).catch(() => {});
    } else if (offlineCapable) {
      const cached = await getCachedProducts(store.id).catch(() => []);
      setProducts(cached as Product[]);
    } else if (fetchError) {
      setProducts([]);
    }
    setLoadingProducts(false);
  }

  async function loadKits() {
    const { data } = await getSupabase()
      .from("kits")
      .select("id, name, price, active, kit_items(quantity, products(stock))")
      .eq("store_id", store.id)
      .eq("active", true);
    if (data) {
      const options: KitOption[] = (
        (data as unknown as { id: string; name: string; price: number; kit_items: { quantity: number; products: { stock: number } | null }[] }[]) ?? []
      ).map((k) => ({
        id: k.id,
        name: k.name,
        price: k.price,
        buildable:
          k.kit_items.length === 0
            ? 0
            : Math.min(...k.kit_items.map((i) => Math.floor((i.products?.stock ?? 0) / (i.quantity || 1)))),
      }));
      setKits(options);
      if (offlineCapable) cacheKits(store.id, options).catch(() => {});
    } else if (offlineCapable) {
      const cached = await getCachedKits(store.id).catch(() => []);
      setKits(cached as KitOption[]);
    }
  }

  async function loadRecentSales() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { data } = await getSupabase()
      .from("orders")
      .select("id, total, payment_method, payment_split, created_at")
      .eq("store_id", store.id)
      .eq("channel", "balcao")
      .gte("created_at", startOfDay.toISOString())
      .order("created_at", { ascending: false });
    setRecentSales(data ?? []);
  }

  const caixaStatusKey = `mm_pdv_caixa_${store.id}`;

  async function loadCaixaStatus() {
    const { data, error: fetchError } = await getSupabase()
      .from("cash_sessions")
      .select("id")
      .eq("store_id", store.id)
      .eq("status", "aberto")
      .maybeSingle();
    if (fetchError && !data) {
      // Sem conexão: usa o último status conhecido (salvo localmente da
      // última vez que consultamos com internet) em vez de travar o PDV.
      const cached = localStorage.getItem(caixaStatusKey);
      if (cached !== null) {
        setCaixaAberto(cached === "1");
        return;
      }
    }
    setCaixaAberto(!!data);
    localStorage.setItem(caixaStatusKey, data ? "1" : "0");
  }

  useEffect(() => {
    loadProducts();
    loadKits();
    loadRecentSales();
    loadCaixaStatus();
    getSupabase()
      .auth.getSession()
      .then(({ data }) => setSellerEmail(data.session?.user.email ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function refreshPendingSaleCount() {
    if (!offlineCapable) return;
    const pending = await getPendingSales(store.id).catch(() => []);
    setPendingSaleCount(pending.length);
  }

  // Reenvia pro servidor cada venda que ficou guardada localmente enquanto
  // estava sem internet. p_allow_negative_stock: true porque a venda já
  // aconteceu de verdade no balcão — não faz sentido rejeitar por estoque
  // agora, só avisar o dono se sobrou diferença.
  async function syncPendingSales() {
    if (!offlineCapable || syncing) return;
    const pending = await getPendingSales(store.id).catch(() => [] as PendingSale[]);
    if (pending.length === 0) {
      setPendingSaleCount(0);
      return;
    }
    setSyncing(true);
    let conflicts = 0;
    let stillPending = 0;
    for (const sale of pending) {
      try {
        const { data, error: rpcError } = await getSupabase().rpc("pdv_sale", {
          ...sale.payload,
          p_allow_negative_stock: true,
        });
        if (rpcError || !data || data.length === 0) {
          await markPendingSaleFailed(sale.localId, rpcError?.message ?? "Falha desconhecida");
          stillPending++;
          continue;
        }
        if (data[0].stock_conflict) conflicts++;
        await removePendingSale(sale.localId);
      } catch {
        stillPending += pending.length - pending.indexOf(sale);
        break;
      }
    }
    setSyncing(false);
    setPendingSaleCount(stillPending);
    if (conflicts > 0) {
      alert(
        `${conflicts} venda${conflicts > 1 ? "s" : ""} feita${conflicts > 1 ? "s" : ""} offline sincronizada${conflicts > 1 ? "s" : ""}, mas com estoque negativo — confere o estoque físico desses produtos.`,
      );
    }
    loadProducts();
    loadRecentSales();
  }

  useEffect(() => {
    function goOnline() {
      setIsOnline(true);
      syncPendingSales();
    }
    function goOffline() {
      setIsOnline(false);
    }
    setIsOnline(navigator.onLine);
    refreshPendingSaleCount();
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine) syncPendingSales();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  useEffect(() => {
    const q = creditSearch.trim();
    if (q.length < 2) {
      setCreditMatches([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const { data } = await getSupabase()
        .from("credit_customers")
        .select("id, name, phone")
        .eq("store_id", store.id)
        .ilike("name", `%${q}%`)
        .limit(6);
      setCreditMatches(data ?? []);
    }, 250);
    return () => clearTimeout(timeout);
  }, [creditSearch, store.id]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const qtyPrefix = useMemo(() => parseQtyPrefix(search), [search]);

  const filtered = useMemo(() => {
    const raw = qtyPrefix ? qtyPrefix.rest : search;
    const q = raw.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q)))
      .slice(0, 8);
  }, [search, qtyPrefix, products]);

  const filteredKits = useMemo(() => {
    const raw = qtyPrefix ? qtyPrefix.rest : search;
    const q = raw.trim().toLowerCase();
    if (!q) return [];
    return kits.filter((k) => k.name.toLowerCase().includes(q)).slice(0, 4);
  }, [search, qtyPrefix, kits]);

  const subtotal = cart.reduce(
    (sum, line) => sum + pdvLineTotal(line, line.quantity, paymentMethod, splitMode),
    0,
  );
  const discountRaw = Number(discountValue.replace(",", ".")) || 0;
  const discountAmount = Math.min(
    subtotal,
    Math.max(0, discountType === "percentual" ? subtotal * (discountRaw / 100) : discountRaw),
  );
  const total = Math.max(0, subtotal - discountAmount);
  const cashReceivedValue = Number(cashReceived.replace(",", ".")) || 0;
  const troco = cashReceivedValue - total;
  const splitAmounts = splitPayments.map((p) => Number(p.amount.replace(",", ".")) || 0);
  const splitSum = splitAmounts.reduce((a, b) => a + b, 0);
  const splitDiff = Math.round((total - splitSum) * 100) / 100;
  const splitHasFiado = splitPayments.some((p, i) => p.method === "fiado" && splitAmounts[i] > 0);

  function focusSearch() {
    searchInputRef.current?.focus();
  }

  function addToCart(product: Product, qtyOverride?: number) {
    const qty = qtyOverride && qtyOverride > 0 ? qtyOverride : 1;
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: round3(l.quantity + qty) } : l,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          price: product.price,
          quantity: qty,
          stock: product.stock,
          soldByWeight: product.sold_by_weight,
          promoBuyQty: product.promo_buy_qty,
          promoPayQty: product.promo_pay_qty,
          priceWholesale: product.price_wholesale,
          wholesaleMinQty: product.wholesale_min_qty,
          priceFiado: product.price_fiado,
          onOffer: product.on_offer,
          offerPrice: product.offer_price,
          offerEndsAt: product.offer_ends_at,
        },
      ];
    });
    playBeep();
    setSearch("");
    setQuickAddOpen(false);
    setSuccess(null);
    focusSearch();
  }

  function addKitToCart(kit: KitOption, qtyOverride?: number) {
    const qty = qtyOverride && qtyOverride > 0 ? qtyOverride : 1;
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === kit.id && l.isKit);
      if (existing) {
        return prev.map((l) => (l.productId === kit.id && l.isKit ? { ...l, quantity: round3(l.quantity + qty) } : l));
      }
      return [
        ...prev,
        {
          productId: kit.id,
          name: `Kit: ${kit.name}`,
          price: kit.price,
          quantity: qty,
          stock: kit.buildable,
          soldByWeight: false,
          isKit: true,
        },
      ];
    });
    playBeep();
    setSearch("");
    setQuickAddOpen(false);
    setSuccess(null);
    focusSearch();
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    if (filtered.length > 0) {
      e.preventDefault();
      addToCart(filtered[0], qtyPrefix?.qty);
    } else if (filteredKits.length > 0) {
      e.preventDefault();
      addKitToCart(filteredKits[0], qtyPrefix?.qty);
    }
  }

  // Roda direto no onChange (síncrono) em vez de useEffect: um leitor de código
  // de barras digita tudo e manda Enter em seguida tão rápido que um useEffect
  // (assíncrono) ainda não tinha limpado a busca quando o Enter chegava, e o
  // item acabava entrando 2x — uma vez por aqui, outra pelo handleSearchKeyDown.
  function handleSearchChange(value: string) {
    setQuickAddOpen(false);
    const parsed = parseQtyPrefix(value);
    const raw = parsed ? parsed.rest : value;
    const q = raw.trim();
    if (q.length >= 6) {
      const exactBarcode = products.find((p) => p.barcode === q);
      if (exactBarcode) {
        addToCart(exactBarcode, parsed?.qty);
        return;
      }
    }
    setSearch(value);
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: round3(l.quantity + delta) } : l))
        .filter((l) => l.quantity > 0.0005),
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  function cancelSale() {
    if (cart.length === 0) return;
    if (!window.confirm("Cancelar essa venda e limpar o carrinho?")) return;
    setCart([]);
    setPaymentMethod(null);
    setCashReceived("");
    setCustomerName("");
    setCustomerPhone("");
    setCreditSearch("");
    setCreditMatches([]);
    setCreditCustomerId(null);
    setDiscountValue("");
    setError(null);
    focusSearch();
  }

  function repeatLastSale() {
    if (!lastSale) return;
    setCart(
      lastSale.map((line) => {
        if (line.isKit) {
          const currentKit = kits.find((k) => k.id === line.productId);
          return currentKit ? { ...line, price: currentKit.price, stock: currentKit.buildable } : line;
        }
        const current = products.find((p) => p.id === line.productId);
        return current
          ? {
              ...line,
              price: current.price,
              stock: current.stock,
              soldByWeight: current.sold_by_weight,
              promoBuyQty: current.promo_buy_qty,
              promoPayQty: current.promo_pay_qty,
              priceWholesale: current.price_wholesale,
              wholesaleMinQty: current.wholesale_min_qty,
              priceFiado: current.price_fiado,
              onOffer: current.on_offer,
              offerPrice: current.offer_price,
              offerEndsAt: current.offer_ends_at,
            }
          : line;
      }),
    );
    setSuccess(null);
    focusSearch();
  }

  function printReceipt(
    items: CartLine[],
    saleTotal: number,
    method: PaymentMethod | "dividido",
    troco: number | null,
    split: { method: PaymentMethod; amount: number }[] | null,
    saleSubtotal?: number,
    saleDiscount?: number,
  ) {
    const html = buildReceiptHtml({
      storeName: store.name,
      whatsapp: store.whatsapp,
      cnpj: store.cnpj,
      paperMm: store.receipt_paper_mm || 55,
      items: items.map((line) => ({
        name: line.name,
        qtyLabel: formatQty(line),
        lineTotal: pdvLineTotal(line, line.quantity, split ? null : (method as PaymentMethod), split !== null),
      })),
      subtotal: saleSubtotal,
      discount: saleDiscount,
      total: saleTotal,
      paymentLines: split
        ? split.map((p) => `${PAYMENT_LABELS[p.method]}: ${formatCurrency(p.amount)}`)
        : [`Pagamento: ${PAYMENT_LABELS[method]}`],
      troco,
    });
    printHtml(html);
  }

  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault();
    const priceValue = Number(quickAddPrice.replace(",", "."));
    const stockValue = Number(quickAddStock) || 0;
    if (!quickAddName.trim() || Number.isNaN(priceValue) || priceValue < 0) return;

    setQuickAddSaving(true);
    const { data, error: insertError } = await getSupabase()
      .from("products")
      .insert({
        store_id: store.id,
        name: quickAddName.trim(),
        price: priceValue,
        stock: stockValue,
        barcode: quickAddBarcode.trim() || null,
        sold_by_weight: quickAddSoldByWeight,
      })
      .select(
        "id, name, price, stock, barcode, sold_by_weight, promo_buy_qty, promo_pay_qty, price_wholesale, wholesale_min_qty, price_fiado, on_offer, offer_price, offer_ends_at",
      )
      .single();
    setQuickAddSaving(false);

    if (insertError || !data) {
      setError("Não deu pra cadastrar o produto: " + insertError?.message);
      return;
    }

    setProducts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setQuickAddName("");
    setQuickAddBarcode("");
    setQuickAddPrice("");
    setQuickAddStock("");
    setQuickAddSoldByWeight(false);
    addToCart(data, qtyPrefix?.qty);
  }

  function selectPayment(method: PaymentMethod) {
    setPaymentMethod(method);
    setError(null);
    if (method !== "dinheiro") setCashReceived("");
    if (method !== "fiado") {
      setCreditSearch("");
      setCreditMatches([]);
      setCreditCustomerId(null);
      setCustomerName("");
      setCustomerPhone("");
    }
  }

  function selectCreditCustomer(customer: CreditCustomer) {
    setCreditCustomerId(customer.id);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone);
    setCreditSearch(customer.name);
    setCreditMatches([]);
  }

  function focusCreditSearch() {
    if (splitMode) {
      setTimeout(() => creditSearchRef.current?.focus(), 0);
      return;
    }
    if (paymentMethod !== "fiado") selectPayment("fiado");
    setTimeout(() => creditSearchRef.current?.focus(), 0);
  }

  function toggleSplitMode() {
    setSplitMode((prev) => {
      const next = !prev;
      setPaymentMethod(null);
      setCashReceived("");
      setCreditSearch("");
      setCreditMatches([]);
      setCreditCustomerId(null);
      setCustomerName("");
      setCustomerPhone("");
      if (next) {
        setSplitPayments([
          { method: "dinheiro", amount: "" },
          { method: "fiado", amount: "" },
        ]);
      }
      return next;
    });
  }

  function updateSplitRow(index: number, patch: Partial<{ method: PaymentMethod; amount: string }>) {
    setSplitPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function addSplitRow() {
    setSplitPayments((prev) => (prev.length >= 4 ? prev : [...prev, { method: "cartao", amount: "" }]));
  }

  function removeSplitRow(index: number) {
    setSplitPayments((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  const canFinalize =
    cart.length > 0 &&
    !saving &&
    (splitMode
      ? splitAmounts.every((a) => a > 0) &&
        Math.abs(splitDiff) < 0.005 &&
        (!splitHasFiado || customerPhone.trim().length > 0)
      : paymentMethod !== null &&
        !(paymentMethod === "dinheiro" && cashReceivedValue < total) &&
        !(paymentMethod === "fiado" && !customerPhone.trim()));

  async function handleFinalize() {
    if (!canFinalize) return;
    setSaving(true);
    setError(null);

    const items = cart.map((l) =>
      l.isKit ? { kit_id: l.productId, quantity: l.quantity } : { product_id: l.productId, quantity: l.quantity },
    );

    const payload: Record<string, unknown> = splitMode
      ? {
          p_store_id: store.id,
          p_items: items,
          p_payment_method: "dividido",
          p_customer_name: customerName.trim() || "Cliente balcão",
          p_customer_phone: customerPhone.trim() || null,
          p_payments: splitPayments.map((p, i) => ({ method: p.method, amount: splitAmounts[i] })),
          p_discount_amount: discountAmount,
        }
      : {
          p_store_id: store.id,
          p_items: items,
          p_payment_method: paymentMethod,
          p_customer_name: customerName.trim() || "Cliente balcão",
          p_customer_phone: customerPhone.trim() || null,
          p_discount_amount: discountAmount,
        };

    let saleTotal = total;
    let wentOffline = false;

    // Sem internet: nem tenta a chamada, guarda direto na fila local pra
    // não travar o caixa esperando um pedido que nunca vai responder.
    const shouldTryNetwork = navigator.onLine;
    let networkFailed = false;
    let rpcMessage: string | null = null;

    if (shouldTryNetwork) {
      try {
        const { data, error: rpcError } = await getSupabase().rpc("pdv_sale", payload);
        if (rpcError) {
          // pdv_sale() só recusa venda com "raise exception" liso, sem
          // SQLSTATE próprio — isso sempre vira o código P0001 no Postgres.
          // Qualquer OUTRA coisa (rede caiu, sessão expirou depois de
          // horas offline, erro 500 inesperado) não é isso — mais seguro
          // tratar como "sem internet" e guardar na fila pra tentar de
          // novo depois do que arriscar mostrar erro e perder a venda.
          if (rpcError.code === "P0001") {
            rpcMessage = rpcError.message;
          } else {
            networkFailed = true;
          }
        } else if (!data || data.length === 0) {
          rpcMessage = "Não deu pra registrar a venda.";
        } else {
          saleTotal = data[0].total;
        }
      } catch {
        networkFailed = true;
      }
    } else {
      networkFailed = true;
    }

    if (rpcMessage) {
      setSaving(false);
      setError(rpcMessage);
      return;
    }

    if (networkFailed) {
      if (!offlineCapable) {
        setSaving(false);
        setError("Sem internet e esse navegador não guarda vendas offline. Tenta de novo quando a conexão voltar.");
        return;
      }
      await queueSale(store.id, payload, cart);
      wentOffline = true;
      setPendingSaleCount((n) => n + 1);
      // Desconta o estoque só localmente pros próximos itens da sessão
      // offline não venderem além do que realmente existe — o valor de
      // verdade é recalculado no servidor quando sincronizar.
      setProducts((prev) => {
        const next = prev.map((p) => ({ ...p }));
        for (const line of cart) {
          if (line.isKit) continue;
          const p = next.find((x) => x.id === line.productId);
          if (p) p.stock = Math.max(0, p.stock - line.quantity);
        }
        if (offlineCapable) cacheProducts(store.id, next).catch(() => {});
        return next;
      });
    }

    setSaving(false);

    setSuccess({
      total: saleTotal,
      subtotal,
      discountAmount,
      troco: !splitMode && paymentMethod === "dinheiro" ? cashReceivedValue - saleTotal : null,
      items: cart,
      method: splitMode ? "dividido" : (paymentMethod as PaymentMethod),
      split: splitMode ? splitPayments.map((p, i) => ({ method: p.method, amount: splitAmounts[i] })) : null,
      offline: wentOffline,
    });
    setLastSale(cart);
    setCart([]);
    setPaymentMethod(null);
    setCashReceived("");
    setCustomerName("");
    setCustomerPhone("");
    setCreditSearch("");
    setCreditMatches([]);
    setCreditCustomerId(null);
    setDiscountValue("");
    if (splitMode) {
      setSplitPayments([
        { method: "dinheiro", amount: "" },
        { method: "fiado", amount: "" },
      ]);
    }
    if (!wentOffline) {
      loadProducts();
      loadKits();
      loadRecentSales();
    }
    focusSearch();
  }

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (!e.key.startsWith("F")) return;
      switch (e.key) {
        case "F1":
          e.preventDefault();
          setShowShortcuts((prev) => !prev);
          break;
        case "F2":
          e.preventDefault();
          focusSearch();
          break;
        case "F3":
          e.preventDefault();
          selectPayment("dinheiro");
          break;
        case "F4":
          e.preventDefault();
          selectPayment("pix");
          break;
        case "F5":
          e.preventDefault();
          selectPayment("cartao");
          break;
        case "F6":
          e.preventDefault();
          selectPayment("fiado");
          break;
        case "F7":
          e.preventDefault();
          handleFinalize();
          break;
        case "F8":
          e.preventDefault();
          cancelSale();
          break;
        case "F9":
          e.preventDefault();
          focusCreditSearch();
          break;
        case "F10":
          e.preventDefault();
          toggleSplitMode();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, paymentMethod, cashReceivedValue, customerPhone, saving, total, creditCustomerId, splitMode, splitPayments, customerName]);

  const PAYMENT_OPTIONS: [PaymentMethod, string, (p: { className?: string }) => React.JSX.Element][] = [
    ["dinheiro", "Dinheiro", IconBanknote],
    ["pix", "Pix", IconPix],
    ["cartao", "Cartão", IconCard],
    ["fiado", "Crediário", IconBook],
  ];

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-black">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -top-44 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-50 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(52,232,140,0.16), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-36 top-56 h-[420px] w-[420px] rounded-full opacity-50 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(92,172,255,0.14), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-36 -bottom-16 h-[380px] w-[380px] rounded-full opacity-30 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(240,187,94,0.12), transparent 65%)" }}
      />

      <div className="relative grid grid-cols-1 gap-5 p-4 text-[#F5F3EF] sm:p-6 lg:grid-cols-[1fr_400px]">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#F5F3EF]">
              PDV <span className="font-normal text-white/35">— venda no balcão</span>
            </h1>
            {sellerEmail && (
              <p className="mt-0.5 text-xs text-white/30">Vendendo como {sellerEmail}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowShortcuts((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 py-1.5 text-sm font-medium text-white/55 backdrop-blur-xl transition hover:bg-white/[0.06] hover:text-white/80"
            >
              <IconKeyboard className="h-4 w-4" />
              Atalhos
              <kbd className="ml-0.5 rounded bg-white/10 px-1 py-0.5 font-mono text-[10px] text-white/45">F1</kbd>
            </button>
            {lastSale && lastSale.length > 0 && (
              <button
                onClick={repeatLastSale}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 py-1.5 text-sm font-medium text-white/55 backdrop-blur-xl transition hover:bg-white/[0.06] hover:text-white/80"
              >
                <IconRepeat className="h-4 w-4" />
                Repetir última venda
              </button>
            )}
          </div>
        </div>

        {showShortcuts && (
          <div className="mt-3 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {SHORTCUTS.map(([key, label]) => (
                <p key={key} className="flex items-center gap-2 text-white/50">
                  <kbd className="w-9 shrink-0 rounded-md bg-white/10 py-1 text-center font-mono text-xs font-semibold text-white/70">
                    {key}
                  </kbd>
                  {label}
                </p>
              ))}
            </div>
          </div>
        )}

        {caixaAberto === false && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-[#F0BB5E]/25 bg-[#F0BB5E]/10 px-3 py-2.5 text-sm text-[#F0BB5E]">
            <IconWarning className="h-4 w-4 shrink-0" />
            O caixa de hoje ainda não foi aberto.{" "}
            <a href="/painel/caixa" className="font-semibold underline underline-offset-2">
              Abrir caixa
            </a>
          </p>
        )}

        {!isOnline && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-[#FF5C68]/25 bg-[#FF5C68]/10 px-3 py-2.5 text-sm text-[#FF5C68]">
            <IconWarning className="h-4 w-4 shrink-0" />
            Sem internet — o PDV continua vendendo normal e guarda tudo pra sincronizar quando a conexão voltar.
          </p>
        )}

        {isOnline && pendingSaleCount > 0 && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-[#5CACFF]/25 bg-[#5CACFF]/10 px-3 py-2.5 text-sm text-[#5CACFF]">
            <IconWarning className="h-4 w-4 shrink-0" />
            {syncing
              ? "Sincronizando vendas feitas sem internet…"
              : `${pendingSaleCount} venda${pendingSaleCount > 1 ? "s" : ""} ainda não sincronizada${pendingSaleCount > 1 ? "s" : ""}.`}
          </p>
        )}

        <div className="relative mt-4">
          <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/30" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Buscar por nome ou passar código de barras…"
            autoComplete="off"
            className="w-full rounded-xl border border-white/[0.09] bg-white/[0.035] py-3.5 pl-11 pr-4 text-base text-[#F5F3EF] backdrop-blur-xl transition placeholder:text-white/25 focus:border-[#5CACFF]/50 focus:outline-none focus:ring-2 focus:ring-[#5CACFF]/15"
          />

          {search.trim() && (
            <div className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-xl border border-white/10 bg-[#141414] shadow-2xl shadow-black/50">
              {loadingProducts ? (
                <p className="px-4 py-3 text-sm text-white/40">Carregando…</p>
              ) : filtered.length > 0 || filteredKits.length > 0 ? (
                <>
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addToCart(p, qtyPrefix?.qty)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-white/[0.06]"
                    >
                      <span className="flex items-center gap-1.5 text-[#F5F3EF]">
                        {p.name}
                        {p.sold_by_weight && <IconScale className="h-3.5 w-3.5 text-white/30" />}
                      </span>
                      <span className="shrink-0 text-white/40">
                        {formatCurrency(
                          p.on_offer && p.offer_price != null && (!p.offer_ends_at || new Date(p.offer_ends_at) > new Date())
                            ? p.offer_price
                            : p.price,
                        )}
                        {p.sold_by_weight ? "/kg" : ""} · estoque{" "}
                        {Number.isInteger(p.stock) ? p.stock : p.stock.toFixed(3)}
                      </span>
                    </button>
                  ))}
                  {filteredKits.map((k) => (
                    <button
                      key={k.id}
                      onClick={() => addKitToCart(k, qtyPrefix?.qty)}
                      disabled={k.buildable <= 0}
                      className="flex w-full items-center justify-between border-t border-white/[0.06] px-4 py-2.5 text-left text-sm transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#B98CFF]/15 px-2 py-0.5 text-xs font-semibold text-[#B98CFF]">
                        Kit
                      </span>
                      <span className="min-w-0 flex-1 truncate px-2 text-[#F5F3EF]">{k.name}</span>
                      <span className="shrink-0 text-white/40">
                        {formatCurrency(k.price)} · {k.buildable > 0 ? `dá pra montar ${k.buildable}` : "sem estoque"}
                      </span>
                    </button>
                  ))}
                  {qtyPrefix && (
                    <p className="flex items-center gap-1.5 border-t border-white/[0.06] bg-white/[0.03] px-4 py-1.5 text-xs text-white/40">
                      {qtyPrefix.mode === "peso" ? (
                        <>
                          <IconScale className="h-3.5 w-3.5" /> Vai adicionar {qtyPrefix.qty.toFixed(3)} kg do produto escolhido
                        </>
                      ) : (
                        `Vai adicionar ${qtyPrefix.qty} unidades do produto escolhido`
                      )}
                    </p>
                  )}
                </>
              ) : (
                <div className="px-4 py-3">
                  <p className="text-sm text-white/40">
                    Nenhum produto encontrado pra &quot;{search.trim()}&quot;.
                  </p>
                  {!quickAddOpen ? (
                    <button
                      onClick={() => {
                        const q = search.trim();
                        const looksLikeBarcode = /^\d{6,}$/.test(q);
                        setQuickAddName(looksLikeBarcode ? "" : q);
                        setQuickAddBarcode(looksLikeBarcode ? q : "");
                        setQuickAddOpen(true);
                      }}
                      className="mt-2 text-sm font-semibold text-[#5CACFF] hover:underline"
                    >
                      Cadastrar rápido
                    </button>
                  ) : (
                    <form onSubmit={handleQuickAdd} className="mt-2 flex flex-col gap-2">
                      <input
                        value={quickAddName}
                        onChange={(e) => setQuickAddName(e.target.value)}
                        placeholder="Nome do produto"
                        autoFocus
                        className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-[#F5F3EF] placeholder:text-white/25"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={quickAddBarcode}
                          onChange={(e) => setQuickAddBarcode(e.target.value)}
                          placeholder="Código de barras (opcional)"
                          className="w-40 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-[#F5F3EF] placeholder:text-white/25"
                        />
                        <input
                          value={quickAddPrice}
                          onChange={(e) => setQuickAddPrice(e.target.value)}
                          placeholder="Preço (R$)"
                          inputMode="decimal"
                          className="w-28 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-[#F5F3EF] placeholder:text-white/25"
                        />
                        <input
                          value={quickAddStock}
                          onChange={(e) => setQuickAddStock(e.target.value)}
                          placeholder={quickAddSoldByWeight ? "Estoque (kg)" : "Estoque"}
                          inputMode="decimal"
                          className="w-24 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-[#F5F3EF] placeholder:text-white/25"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-white/45">
                          <input
                            type="checkbox"
                            checked={quickAddSoldByWeight}
                            onChange={(e) => setQuickAddSoldByWeight(e.target.checked)}
                            className="h-4 w-4 rounded border-white/20 bg-transparent"
                          />
                          <IconScale className="h-3.5 w-3.5" /> por kg
                        </label>
                        <button
                          type="submit"
                          disabled={quickAddSaving}
                          className="rounded-lg bg-[#F0BB5E] px-3 py-1.5 text-sm font-semibold text-[#241705] disabled:opacity-60"
                        >
                          {quickAddSaving ? "Salvando…" : "Salvar e adicionar"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-white/30">
              {cart.length} {cart.length === 1 ? "item" : "itens"} no carrinho
            </p>
            <button
              onClick={cancelSale}
              className="inline-flex items-center gap-1 text-sm font-medium text-[#FF5C68] hover:underline"
            >
              <IconTrash className="h-3.5 w-3.5" />
              Cancelar venda
            </button>
          </div>
        )}

        <div className="mt-2 space-y-2">
          {cart.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.025] px-4 py-12 text-center backdrop-blur-xl">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.05]">
                <IconCart className="h-7 w-7 text-white/25" />
              </span>
              <p className="text-sm text-white/40">
                Carrinho vazio — busque um produto acima pra começar a venda.
              </p>
            </div>
          )}
          {cart.map((line) => (
            <div
              key={line.productId}
              className="flex flex-col gap-2.5 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-3.5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium text-[#F5F3EF]">{line.name}</p>
                <p className="text-sm text-white/40">
                  {formatCurrency(line.price)} {line.soldByWeight ? "/kg" : "un."}
                </p>
                {line.quantity > line.stock && (
                  <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#FF5C68]/10 px-2 py-0.5 text-xs font-medium text-[#FF5C68]">
                    <IconWarning className="h-3 w-3" />
                    Só tem {line.soldByWeight ? line.stock.toFixed(3) : line.stock} em estoque
                  </p>
                )}
                {line.quantity <= line.stock && line.quantity === line.stock && (
                  <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#F0BB5E]/10 px-2 py-0.5 text-xs font-medium text-[#F0BB5E]">
                    <IconWarning className="h-3 w-3" />
                    Vai zerar o estoque
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <div className="flex items-center gap-1.5 rounded-lg border border-white/10 p-1">
                  <button
                    onClick={() => changeQuantity(line.productId, line.soldByWeight ? -0.1 : -1)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-white/55 transition hover:bg-white/10"
                    aria-label="Diminuir quantidade"
                  >
                    −
                  </button>
                  <span className="w-16 text-center text-sm font-semibold tabular-nums text-[#F5F3EF]">
                    {formatQty(line)}
                  </span>
                  <button
                    onClick={() => changeQuantity(line.productId, line.soldByWeight ? 0.1 : 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-white/55 transition hover:bg-white/10"
                    aria-label="Aumentar quantidade"
                  >
                    +
                  </button>
                </div>
                <p className="w-20 shrink-0 text-right font-semibold tabular-nums text-[#F5F3EF]">
                  {formatCurrency(pdvLineTotal(line, line.quantity, paymentMethod, splitMode))}
                </p>
                <button
                  onClick={() => removeLine(line.productId)}
                  aria-label="Remover item"
                  className="shrink-0 rounded-lg p-1.5 text-white/30 transition hover:bg-[#FF5C68]/10 hover:text-[#FF5C68]"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {recentSales.length > 0 && (
          <details className="mt-6 overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.035] backdrop-blur-xl">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white/55">
              Vendas de hoje no balcão <span className="text-white/30">({recentSales.length})</span>
            </summary>
            <div className="space-y-1 border-t border-white/[0.06] px-4 py-3 text-sm">
              {recentSales.map((sale) => (
                <div key={sale.id} className="flex justify-between text-white/40">
                  <span>
                    {new Date(sale.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    {sale.payment_method === "dividido" && sale.payment_split
                      ? sale.payment_split
                          .map((p) => `${PAYMENT_LABELS[p.method] ?? p.method} ${formatCurrency(p.amount)}`)
                          .join(" + ")
                      : sale.payment_method
                        ? PAYMENT_LABELS[sale.payment_method] ?? sale.payment_method
                        : "—"}
                  </span>
                  <span className="font-medium tabular-nums text-[#F5F3EF]">
                    {formatCurrency(sale.total)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="h-fit rounded-2xl border border-white/[0.09] bg-white/[0.035] p-5 backdrop-blur-xl">
        {success && (
          <div
            className={`mb-4 rounded-xl border p-3.5 text-sm ${
              success.offline
                ? "border-[#F0BB5E]/25 bg-[#F0BB5E]/10 text-[#F0BB5E]"
                : "border-[#34E88C]/25 bg-[#34E88C]/10 text-[#34E88C]"
            }`}
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <IconCheck className="h-4 w-4" />
              {success.offline ? "Venda guardada (sem internet)!" : "Venda registrada!"} {formatCurrency(success.total)}
            </p>
            {success.offline && (
              <p className="mt-0.5 pl-6">Vai sincronizar sozinha assim que a internet voltar.</p>
            )}
            {success.troco !== null && (
              <p className="mt-0.5 pl-6">Troco: {formatCurrency(Math.max(0, success.troco))}</p>
            )}
            <button
              onClick={() =>
                printReceipt(
                  success.items,
                  success.total,
                  success.method,
                  success.troco,
                  success.split,
                  success.subtotal,
                  success.discountAmount,
                )
              }
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-2"
            >
              <IconPrinter className="h-3.5 w-3.5" />
              Imprimir cupom
            </button>
          </div>
        )}

        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-white/55">Desconto</p>
          <div className="flex items-center gap-1.5">
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as "valor" | "percentual")}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm text-[#F5F3EF]"
            >
              <option value="valor" className="bg-[#141414]">R$</option>
              <option value="percentual" className="bg-[#141414]">%</option>
            </select>
            <input
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="w-20 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-[#F5F3EF] placeholder:text-white/25"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 text-center backdrop-blur-xl">
          {discountAmount > 0 && (
            <p className="text-sm text-white/30 line-through">{formatCurrency(subtotal)}</p>
          )}
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/30">
            Total{discountAmount > 0 ? ` (desconto de ${formatCurrency(discountAmount)})` : ""}
          </p>
          <p
            className="my-0.5 text-4xl font-black tabular-nums tracking-tight"
            style={{
              backgroundImage: "linear-gradient(180deg, #EFFFF6 0%, #34E88C 130%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              textShadow: "0 0 40px rgba(52,232,140,0.3)",
            }}
          >
            {formatCurrency(total)}
          </p>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-white/55">Forma de pagamento</p>
            <button
              onClick={toggleSplitMode}
              className={`inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 ${
                splitMode ? "text-[#5CACFF]" : "text-white/40"
              }`}
            >
              {splitMode ? (
                <>
                  <IconX className="h-3 w-3" /> Cancelar divisão
                </>
              ) : (
                <>
                  <IconSplit className="h-3.5 w-3.5" /> Dividir pagamento <kbd className="font-mono text-[10px]">F10</kbd>
                </>
              )}
            </button>
          </div>

          {!splitMode ? (
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_OPTIONS.map(([value, label, Icon]) => {
                const selected = paymentMethod === value;
                return (
                  <button
                    key={value}
                    onClick={() => selectPayment(value)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      selected
                        ? "border-[#5CACFF]/35 bg-[#5CACFF]/12 text-[#5CACFF]"
                        : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/20 hover:bg-white/[0.05]"
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${selected ? "text-[#5CACFF]" : "text-white/30"}`} />
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-white/10 p-3">
              {splitPayments.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={row.method}
                    onChange={(e) => updateSplitRow(i, { method: e.target.value as PaymentMethod })}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-sm text-[#F5F3EF]"
                  >
                    <option value="dinheiro" className="bg-[#141414]">Dinheiro</option>
                    <option value="pix" className="bg-[#141414]">Pix</option>
                    <option value="cartao" className="bg-[#141414]">Cartão</option>
                    <option value="fiado" className="bg-[#141414]">Crediário</option>
                  </select>
                  <input
                    value={row.amount}
                    onChange={(e) => updateSplitRow(i, { amount: e.target.value })}
                    placeholder="Valor (R$)"
                    inputMode="decimal"
                    className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[#F5F3EF] placeholder:text-white/25"
                  />
                  {splitPayments.length > 2 && (
                    <button
                      onClick={() => removeSplitRow(i)}
                      aria-label="Remover forma de pagamento"
                      className="rounded-lg p-1.5 text-white/30 transition hover:bg-[#FF5C68]/10 hover:text-[#FF5C68]"
                    >
                      <IconX className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {splitPayments.length < 4 && (
                <button
                  onClick={addSplitRow}
                  className="text-xs font-medium text-[#5CACFF] underline underline-offset-2"
                >
                  + Adicionar forma
                </button>
              )}
              <p
                className={`flex items-center gap-1.5 text-sm font-semibold ${
                  Math.abs(splitDiff) < 0.005
                    ? "text-[#34E88C]"
                    : splitDiff > 0
                      ? "text-[#F0BB5E]"
                      : "text-[#FF5C68]"
                }`}
              >
                {Math.abs(splitDiff) < 0.005 ? (
                  <>
                    <IconCheck className="h-3.5 w-3.5" /> Bate certinho com o total
                  </>
                ) : splitDiff > 0 ? (
                  `Falta ${formatCurrency(splitDiff)}`
                ) : (
                  `Passou ${formatCurrency(-splitDiff)}`
                )}
              </p>
            </div>
          )}
        </div>

        {paymentMethod === "dinheiro" && (
          <div className="mt-4 space-y-2.5 rounded-xl border border-white/10 p-3.5">
            <div className="flex flex-wrap gap-1.5">
              {CASH_BUTTONS.map((value) => (
                <button
                  key={value}
                  onClick={() =>
                    setCashReceived((prev) => String((Number(prev.replace(",", ".")) || 0) + value))
                  }
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1 text-sm font-medium text-white/60 transition hover:border-[#5CACFF]/40 hover:text-[#5CACFF]"
                >
                  +{formatCurrency(value)}
                </button>
              ))}
              <button
                onClick={() => setCashReceived(String(total))}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1 text-sm font-medium text-white/60 transition hover:border-[#5CACFF]/40 hover:text-[#5CACFF]"
              >
                Valor exato
              </button>
            </div>
            <input
              value={cashReceived}
              onChange={(e) => setCashReceived(e.target.value)}
              placeholder="Valor recebido (R$)"
              inputMode="decimal"
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[#F5F3EF] placeholder:text-white/25"
            />
            <p className={`text-sm font-semibold tabular-nums ${troco < 0 ? "text-[#FF5C68]" : "text-[#34E88C]"}`}>
              Troco: {formatCurrency(Math.max(0, troco))}
              {troco < 0 && " (falta " + formatCurrency(-troco) + ")"}
            </p>
          </div>
        )}

        {(paymentMethod === "fiado" || (splitMode && splitHasFiado)) && (
          <div className="mt-4 space-y-2.5 rounded-xl border border-white/10 p-3.5">
            <div className="relative">
              <input
                ref={creditSearchRef}
                value={creditSearch}
                onChange={(e) => {
                  setCreditSearch(e.target.value);
                  if (creditCustomerId) {
                    setCreditCustomerId(null);
                    setCustomerName("");
                    setCustomerPhone("");
                  }
                }}
                placeholder="Buscar cliente já cadastrado no crediário"
                autoComplete="off"
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[#F5F3EF] placeholder:text-white/25"
              />
              {creditMatches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-[#141414] shadow-2xl shadow-black/50">
                  {creditMatches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCreditCustomer(c)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/[0.06]"
                    >
                      <span className="text-[#F5F3EF]">{c.name}</span>
                      <span className="text-white/40">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {creditCustomerId ? (
              <p className="flex items-center gap-1.5 rounded-lg bg-[#34E88C]/10 px-3 py-2 text-sm text-[#34E88C]">
                <IconCheck className="h-4 w-4 shrink-0" />
                Cliente encontrado: {customerName} · {customerPhone}
              </p>
            ) : (
              <>
                <p className="text-xs text-white/40">
                  Cliente novo? Preencha os dados abaixo pra cadastrar.
                </p>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nome do cliente"
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[#F5F3EF] placeholder:text-white/25"
                />
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="WhatsApp do cliente (obrigatório pra cliente novo)"
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[#F5F3EF] placeholder:text-white/25"
                />
              </>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-[#FF5C68]">
            <IconWarning className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <button
          onClick={handleFinalize}
          disabled={!canFinalize}
          className="mt-4 w-full rounded-xl bg-[#F0BB5E] px-4 py-3.5 text-base font-bold text-[#241705] shadow-[0_0_30px_rgba(240,187,94,0.25)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none disabled:hover:brightness-100"
        >
          {saving ? "Registrando…" : "Finalizar venda"}
        </button>
      </div>
      </div>
    </div>
  );
}
