"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { buildReceiptHtml, printHtml } from "@/lib/receipt";

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

  async function loadProducts() {
    setLoadingProducts(true);
    const { data } = await getSupabase()
      .from("products")
      .select(
        "id, name, price, stock, barcode, sold_by_weight, promo_buy_qty, promo_pay_qty, price_wholesale, wholesale_min_qty, price_fiado, on_offer, offer_price, offer_ends_at",
      )
      .eq("store_id", store.id)
      .order("name", { ascending: true });
    setProducts(data ?? []);
    setLoadingProducts(false);
  }

  async function loadKits() {
    const { data } = await getSupabase()
      .from("kits")
      .select("id, name, price, active, kit_items(quantity, products(stock))")
      .eq("store_id", store.id)
      .eq("active", true);
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

  async function loadCaixaStatus() {
    const { data } = await getSupabase()
      .from("cash_sessions")
      .select("id")
      .eq("store_id", store.id)
      .eq("status", "aberto")
      .maybeSingle();
    setCaixaAberto(!!data);
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

    const { data, error: rpcError } = await getSupabase().rpc("pdv_sale", payload);
    setSaving(false);

    if (rpcError || !data || data.length === 0) {
      setError(rpcError?.message ?? "Não deu pra registrar a venda.");
      return;
    }

    const sale = data[0];
    setSuccess({
      total: sale.total,
      subtotal,
      discountAmount,
      troco: !splitMode && paymentMethod === "dinheiro" ? cashReceivedValue - sale.total : null,
      items: cart,
      method: splitMode ? "dividido" : (paymentMethod as PaymentMethod),
      split: splitMode ? splitPayments.map((p, i) => ({ method: p.method, amount: splitAmounts[i] })) : null,
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
    loadProducts();
    loadKits();
    loadRecentSales();
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_400px]">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              PDV <span className="font-normal text-slate-400 dark:text-slate-500">— venda no balcão</span>
            </h1>
            {sellerEmail && (
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Vendendo como {sellerEmail}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowShortcuts((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <IconKeyboard className="h-4 w-4" />
              Atalhos
              <kbd className="ml-0.5 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">F1</kbd>
            </button>
            {lastSale && lastSale.length > 0 && (
              <button
                onClick={repeatLastSale}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <IconRepeat className="h-4 w-4" />
                Repetir última venda
              </button>
            )}
          </div>
        </div>

        {showShortcuts && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {SHORTCUTS.map(([key, label]) => (
                <p key={key} className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                  <kbd className="w-9 shrink-0 rounded-md bg-slate-100 py-1 text-center font-mono text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {key}
                  </kbd>
                  {label}
                </p>
              ))}
            </div>
          </div>
        )}

        {caixaAberto === false && (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-400">
            <IconWarning className="h-4 w-4 shrink-0" />
            O caixa de hoje ainda não foi aberto.{" "}
            <a href="/painel/caixa" className="font-semibold underline underline-offset-2">
              Abrir caixa
            </a>
          </p>
        )}

        <div className="relative mt-4">
          <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Buscar por nome ou passar código de barras…"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-11 pr-4 text-base text-slate-900 shadow-sm transition focus:border-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-blue-600"
          />

          {search.trim() && (
            <div className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
              {loadingProducts ? (
                <p className="px-4 py-3 text-sm text-slate-500">Carregando…</p>
              ) : filtered.length > 0 || filteredKits.length > 0 ? (
                <>
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addToCart(p, qtyPrefix?.qty)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-1.5 text-slate-900 dark:text-slate-50">
                        {p.name}
                        {p.sold_by_weight && <IconScale className="h-3.5 w-3.5 text-slate-400" />}
                      </span>
                      <span className="shrink-0 text-slate-500 dark:text-slate-400">
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
                      className="flex w-full items-center justify-between border-t border-slate-100 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:hover:bg-slate-800"
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        Kit
                      </span>
                      <span className="min-w-0 flex-1 truncate px-2 text-slate-900 dark:text-slate-50">{k.name}</span>
                      <span className="shrink-0 text-slate-500 dark:text-slate-400">
                        {formatCurrency(k.price)} · {k.buildable > 0 ? `dá pra montar ${k.buildable}` : "sem estoque"}
                      </span>
                    </button>
                  ))}
                  {qtyPrefix && (
                    <p className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
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
                  <p className="text-sm text-slate-500 dark:text-slate-400">
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
                      className="mt-2 text-sm font-semibold text-blue-900 hover:underline dark:text-blue-400"
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
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={quickAddBarcode}
                          onChange={(e) => setQuickAddBarcode(e.target.value)}
                          placeholder="Código de barras (opcional)"
                          className="w-40 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                        />
                        <input
                          value={quickAddPrice}
                          onChange={(e) => setQuickAddPrice(e.target.value)}
                          placeholder="Preço (R$)"
                          inputMode="decimal"
                          className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                        />
                        <input
                          value={quickAddStock}
                          onChange={(e) => setQuickAddStock(e.target.value)}
                          placeholder={quickAddSoldByWeight ? "Estoque (kg)" : "Estoque"}
                          inputMode="decimal"
                          className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                          <input
                            type="checkbox"
                            checked={quickAddSoldByWeight}
                            onChange={(e) => setQuickAddSoldByWeight(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <IconScale className="h-3.5 w-3.5" /> por kg
                        </label>
                        <button
                          type="submit"
                          disabled={quickAddSaving}
                          className="rounded-lg bg-blue-900 px-3 py-1.5 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
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
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {cart.length} {cart.length === 1 ? "item" : "itens"} no carrinho
            </p>
            <button
              onClick={cancelSale}
              className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:underline dark:text-red-400"
            >
              <IconTrash className="h-3.5 w-3.5" />
              Cancelar venda
            </button>
          </div>
        )}

        <div className="mt-2 space-y-2">
          {cart.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center dark:border-slate-700">
              <IconCart className="h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Carrinho vazio — busque um produto acima pra começar a venda.
              </p>
            </div>
          )}
          {cart.map((line) => (
            <div
              key={line.productId}
              className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium text-slate-900 dark:text-slate-50">{line.name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {formatCurrency(line.price)} {line.soldByWeight ? "/kg" : "un."}
                </p>
                {line.quantity > line.stock && (
                  <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    <IconWarning className="h-3 w-3" />
                    Só tem {line.soldByWeight ? line.stock.toFixed(3) : line.stock} em estoque
                  </p>
                )}
                {line.quantity <= line.stock && line.quantity === line.stock && (
                  <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    <IconWarning className="h-3 w-3" />
                    Vai zerar o estoque
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
                  <button
                    onClick={() => changeQuantity(line.productId, line.soldByWeight ? -0.1 : -1)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label="Diminuir quantidade"
                  >
                    −
                  </button>
                  <span className="w-16 text-center text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                    {formatQty(line)}
                  </span>
                  <button
                    onClick={() => changeQuantity(line.productId, line.soldByWeight ? 0.1 : 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label="Aumentar quantidade"
                  >
                    +
                  </button>
                </div>
                <p className="w-20 shrink-0 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                  {formatCurrency(pdvLineTotal(line, line.quantity, paymentMethod, splitMode))}
                </p>
                <button
                  onClick={() => removeLine(line.productId)}
                  aria-label="Remover item"
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {recentSales.length > 0 && (
          <details className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              Vendas de hoje no balcão <span className="text-slate-400 dark:text-slate-500">({recentSales.length})</span>
            </summary>
            <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
              {recentSales.map((sale) => (
                <div key={sale.id} className="flex justify-between text-slate-600 dark:text-slate-400">
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
                  <span className="font-medium tabular-nums text-slate-900 dark:text-slate-50">
                    {formatCurrency(sale.total)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {success && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3.5 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
            <p className="flex items-center gap-1.5 font-semibold">
              <IconCheck className="h-4 w-4" />
              Venda registrada! {formatCurrency(success.total)}
            </p>
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
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Desconto</p>
          <div className="flex items-center gap-1.5">
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as "valor" | "percentual")}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            >
              <option value="valor">R$</option>
              <option value="percentual">%</option>
            </select>
            <input
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
          {discountAmount > 0 && (
            <p className="text-sm text-slate-400 line-through dark:text-slate-500">{formatCurrency(subtotal)}</p>
          )}
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Total{discountAmount > 0 ? ` (desconto de ${formatCurrency(discountAmount)})` : ""}
          </p>
          <p className="text-4xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
            {formatCurrency(total)}
          </p>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Forma de pagamento</p>
            <button
              onClick={toggleSplitMode}
              className={`inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 ${
                splitMode ? "text-blue-900 dark:text-blue-400" : "text-slate-500 dark:text-slate-400"
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
                        ? "border-blue-900 bg-blue-900 text-amber-300 shadow-sm dark:border-blue-700 dark:bg-blue-800"
                        : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${selected ? "text-amber-300" : "text-slate-400"}`} />
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              {splitPayments.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={row.method}
                    onChange={(e) => updateSplitRow(i, { method: e.target.value as PaymentMethod })}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  >
                    <option value="dinheiro">Dinheiro</option>
                    <option value="pix">Pix</option>
                    <option value="cartao">Cartão</option>
                    <option value="fiado">Crediário</option>
                  </select>
                  <input
                    value={row.amount}
                    onChange={(e) => updateSplitRow(i, { amount: e.target.value })}
                    placeholder="Valor (R$)"
                    inputMode="decimal"
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  />
                  {splitPayments.length > 2 && (
                    <button
                      onClick={() => removeSplitRow(i)}
                      aria-label="Remover forma de pagamento"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                    >
                      <IconX className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {splitPayments.length < 4 && (
                <button
                  onClick={addSplitRow}
                  className="text-xs font-medium text-blue-900 underline underline-offset-2 dark:text-blue-400"
                >
                  + Adicionar forma
                </button>
              )}
              <p
                className={`flex items-center gap-1.5 text-sm font-semibold ${
                  Math.abs(splitDiff) < 0.005
                    ? "text-green-600"
                    : splitDiff > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-red-600"
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
          <div className="mt-4 space-y-2.5 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
            <div className="flex flex-wrap gap-1.5">
              {CASH_BUTTONS.map((value) => (
                <button
                  key={value}
                  onClick={() =>
                    setCashReceived((prev) => String((Number(prev.replace(",", ".")) || 0) + value))
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 transition hover:border-blue-900 hover:text-blue-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:text-blue-400"
                >
                  +{formatCurrency(value)}
                </button>
              ))}
              <button
                onClick={() => setCashReceived(String(total))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 transition hover:border-blue-900 hover:text-blue-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:text-blue-400"
              >
                Valor exato
              </button>
            </div>
            <input
              value={cashReceived}
              onChange={(e) => setCashReceived(e.target.value)}
              placeholder="Valor recebido (R$)"
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
            <p className={`text-sm font-semibold tabular-nums ${troco < 0 ? "text-red-600" : "text-green-600"}`}>
              Troco: {formatCurrency(Math.max(0, troco))}
              {troco < 0 && " (falta " + formatCurrency(-troco) + ")"}
            </p>
          </div>
        )}

        {(paymentMethod === "fiado" || (splitMode && splitHasFiado)) && (
          <div className="mt-4 space-y-2.5 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
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
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
              {creditMatches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
                  {creditMatches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCreditCustomer(c)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="text-slate-900 dark:text-slate-50">{c.name}</span>
                      <span className="text-slate-500 dark:text-slate-400">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {creditCustomerId ? (
              <p className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
                <IconCheck className="h-4 w-4 shrink-0" />
                Cliente encontrado: {customerName} · {customerPhone}
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cliente novo? Preencha os dados abaixo pra cadastrar.
                </p>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nome do cliente"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                />
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="WhatsApp do cliente (obrigatório pra cliente novo)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                />
              </>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <IconWarning className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <button
          onClick={handleFinalize}
          disabled={!canFinalize}
          className="mt-4 w-full rounded-xl bg-blue-900 px-4 py-3.5 text-base font-semibold text-amber-300 shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 dark:bg-blue-800"
        >
          {saving ? "Registrando…" : "Finalizar venda"}
        </button>
      </div>
    </div>
  );
}
