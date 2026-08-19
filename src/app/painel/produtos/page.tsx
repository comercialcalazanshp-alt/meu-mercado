"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import PhotoField from "@/components/PhotoField";

function buildProductPrompt(name: string, category: string | null) {
  return [
    `Foto de produto para catálogo de mercado: "${name}"${category ? ` (categoria: ${category})` : ""}.`,
    "Fundo branco ou neutro, bem iluminada, produto centralizado e ocupando bem o quadro,",
    "estilo padronizado de e-commerce, sem marcas d'água, sem texto sobreposto.",
  ].join(" ");
}

type Product = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  cost_price: number | null;
  image_url: string | null;
  stock: number;
  active: boolean;
  blocked_by_hub: boolean;
  promo_buy_qty: number | null;
  promo_pay_qty: number | null;
  barcode: string | null;
  price_fiado: number | null;
  price_wholesale: number | null;
  wholesale_min_qty: number | null;
  stock_alert_threshold: number;
  expiry_date: string | null;
  supplier: string | null;
  on_offer: boolean;
  offer_price: number | null;
  offer_ends_at: string | null;
  sold_by_weight: boolean;
  created_at: string;
};

type SalesStat = {
  units_sold_recent: number;
  revenue_recent: number;
  profit_recent: number | null;
  avg_daily_sales: number;
  last_sold_at: string | null;
};

type StockMovement = {
  id: string;
  type: "compra" | "perda" | "quebra" | "outro";
  quantity: number;
  unit_cost: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

const MOVEMENT_LABEL: Record<StockMovement["type"], string> = {
  compra: "Compra",
  perda: "Perda",
  quebra: "Quebra",
  outro: "Outro",
};

// BarcodeDetector é nativo do navegador (Chrome/Android), sem tipos no TS
// ainda. Funciona no Chrome do Android; no iPhone (Safari) não tem suporte —
// nesse caso a gente já avisa e a pessoa usa o leitor físico ou digita.
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;
function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) return null;
  return (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
}

// Levenshtein simples pra achar produto com nome parecido (cadastro
// duplicado por engano, ex: "Arroz Tio Joao 5kg" digitado duas vezes).
function normalizeForCompare(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function similarProduct(name: string, others: Product[]): Product | null {
  const target = normalizeForCompare(name);
  if (target.length < 3) return null;
  for (const p of others) {
    const candidate = normalizeForCompare(p.name);
    if (candidate === target) return p;
    const maxLen = Math.max(target.length, candidate.length);
    const distance = levenshtein(target, candidate);
    if (distance / maxLen < 0.15) return p;
  }
  return null;
}

// A etiqueta usa QR code (via a mesma biblioteca já usada no cartaz da loja)
// pra representar o código de barras de forma escaneável, em vez de desenhar
// um código de barras tradicional na mão: sem uma leitora física pra testar,
// arriscar errar o desenho e imprimir uma etiqueta que parece código de
// barras mas não escaneia é pior do que não ter nada. QR code funciona com
// qualquer leitor de câmera/celular, e o número grande embaixo continua
// servindo pra digitar direto se precisar.

function daysUntil(dateIso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateIso + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function daysSince(dateIso: string): number {
  return Math.round((Date.now() - new Date(dateIso).getTime()) / 86400000);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

function toCsvValue(value: string) {
  // Prefixo pra evitar que um valor tipo "=algo" vire fórmula ativa quando o
  // CSV é aberto no Excel/Sheets (protege qualquer usuário do painel que
  // abra o arquivo, não só o dono).
  const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  if (/[",\n]/.test(safe)) return '"' + safe.replace(/"/g, '""') + '"';
  return safe;
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function PriceHistoryChart({ productId }: { productId: string }) {
  const [history, setHistory] = useState<{ price: number; changed_at: string }[] | null>(null);

  useEffect(() => {
    let active = true;
    getSupabase()
      .from("product_price_history")
      .select("price, changed_at")
      .eq("product_id", productId)
      .order("changed_at", { ascending: true })
      .then(({ data }) => {
        if (active) setHistory(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  if (history === null) {
    return <p className="text-xs text-slate-400">Carregando histórico…</p>;
  }
  if (history.length <= 1) {
    return <p className="text-xs text-slate-400">Ainda não teve mudança de preço registrada.</p>;
  }

  const prices = history.map((h) => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const width = 280;
  const height = 56;
  const padX = 6;
  const padY = 8;
  const points = history.map((h, i) => ({
    x: padX + (i / (history.length - 1)) * (width - padX * 2),
    y: height - padY - ((h.price - min) / range) * (height - padY * 2),
    price: h.price,
    date: h.changed_at,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-14 w-full max-w-xs text-blue-900 dark:text-blue-400"
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="currentColor">
            <title>
              {new Date(p.date).toLocaleDateString("pt-BR")} — {formatCurrency(p.price)}
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
        {history.map((h, i) => (
          <span key={i}>
            {new Date(h.changed_at).toLocaleDateString("pt-BR")}: {formatCurrency(h.price)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Produtos() {
  const store = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [desiredMarkup, setDesiredMarkup] = useState("");
  const [stock, setStock] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [barcode, setBarcode] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [supplier, setSupplier] = useState("");
  const [soldByWeight, setSoldByWeight] = useState(false);
  const [wholesaleModeNew, setWholesaleModeNew] = useState<"valor" | "percentual">("valor");
  const [wholesalePriceNew, setWholesalePriceNew] = useState("");
  const [wholesaleMinQtyNew, setWholesaleMinQtyNew] = useState("");
  const [saving, setSaving] = useState(false);
  const [promoDrafts, setPromoDrafts] = useState<Record<string, { buy: string; pay: string }>>({});
  const [wholesaleDrafts, setWholesaleDrafts] = useState<
    Record<string, { price: string; minQty: string; mode: "valor" | "percentual" }>
  >({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [offerDrafts, setOfferDrafts] = useState<Record<string, string>>({});
  const [offerUiOpen, setOfferUiOpen] = useState<Record<string, boolean>>({});
  const [offerEndsAtDrafts, setOfferEndsAtDrafts] = useState<Record<string, string>>({});

  const [search, setSearch] = useState("");
  const [gapFilter, setGapFilter] = useState<"photo" | "cost" | "category" | null>(null);
  const productsTableRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<Record<string, SalesStat>>({});
  const [movements, setMovements] = useState<Record<string, StockMovement[]>>({});
  const [lossDrafts, setLossDrafts] = useState<
    Record<string, { type: StockMovement["type"]; quantity: string; note: string }>
  >({});
  const [savingLoss, setSavingLoss] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [adjustCategory, setAdjustCategory] = useState("");
  const [adjustPercent, setAdjustPercent] = useState("");
  const [adjustingPrices, setAdjustingPrices] = useState(false);
  const [adjustResult, setAdjustResult] = useState<string | null>(null);

  const [scanningBarcode, setScanningBarcode] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanVideoRef = useRef<HTMLVideoElement>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const [lookingUpBarcode, setLookingUpBarcode] = useState(false);
  const [barcodeLookupResult, setBarcodeLookupResult] = useState<"achou" | "nao_achou" | null>(null);

  function openBarcodeScanner() {
    if (!getBarcodeDetectorCtor()) {
      window.alert(
        "Esse navegador não sabe ler código de barras pela câmera (funciona no Chrome do Android). Use um leitor físico ou digite o código na mão.",
      );
      return;
    }
    setScanError(null);
    setScanningBarcode(true);
  }

  function closeBarcodeScanner() {
    setScanningBarcode(false);
    scanStreamRef.current?.getTracks().forEach((t) => t.stop());
    scanStreamRef.current = null;
  }

  // Busca o produto num banco de código de barras aberto e gratuito (Open
  // Food Facts) só pra sugerir o nome — nunca trava o cadastro se o serviço
  // estiver fora do ar ou não achar o produto, o dono sempre pode digitar.
  async function lookupBarcodeProduct(code: string) {
    const trimmed = code.trim();
    if (!trimmed || name.trim()) return;
    setLookingUpBarcode(true);
    setBarcodeLookupResult(null);
    try {
      const res = await fetch(`/api/barcode-lookup?code=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (data.found) {
        setName(data.name);
        if (data.image_url && !imageUrl.trim()) setImageUrl(data.image_url);
        setBarcodeLookupResult("achou");
      } else {
        setBarcodeLookupResult("nao_achou");
      }
    } catch {
      setBarcodeLookupResult("nao_achou");
    } finally {
      setLookingUpBarcode(false);
    }
  }

  useEffect(() => {
    if (!scanningBarcode) return;
    const Detector = getBarcodeDetectorCtor();
    if (!Detector) return;

    let cancelled = false;
    let rafId = 0;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        scanStreamRef.current = stream;
        if (scanVideoRef.current) {
          scanVideoRef.current.srcObject = stream;
          await scanVideoRef.current.play();
        }
        const detector = new Detector!({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"],
        });
        const tick = async () => {
          if (cancelled || !scanVideoRef.current) return;
          try {
            const codes = await detector.detect(scanVideoRef.current);
            if (codes.length > 0) {
              setBarcode(codes[0].rawValue);
              closeBarcodeScanner();
              lookupBarcodeProduct(codes[0].rawValue);
              return;
            }
          } catch {
            // não deu pra ler esse quadro, tenta o próximo
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch {
        setScanError("Não deu pra acessar a câmera. Verifique se você liberou a permissão pro navegador.");
      }
    }
    start();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      scanStreamRef.current?.getTracks().forEach((t) => t.stop());
      scanStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanningBarcode]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [products]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (gapFilter === "photo") list = list.filter((p) => !p.image_url);
    else if (gapFilter === "cost") list = list.filter((p) => p.cost_price === null);
    else if (gapFilter === "category") list = list.filter((p) => !p.category);

    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.includes(q)),
    );
  }, [products, search, gapFilter]);

  const catalogGaps = useMemo(() => {
    const withoutPhoto = products.filter((p) => !p.image_url).length;
    const withoutCost = products.filter((p) => p.cost_price === null).length;
    const withoutCategory = products.filter((p) => !p.category).length;
    return { withoutPhoto, withoutCost, withoutCategory };
  }, [products]);

  function jumpToGap(kind: "photo" | "cost" | "category") {
    setGapFilter((prev) => (prev === kind ? null : kind));
    setSearch("");
    setTimeout(() => productsTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  useEffect(() => {
    if (gapFilter && filteredProducts.length > 0) {
      setExpandedId(filteredProducts[0].id);
      if (filteredProducts[0].id) loadMovements(filteredProducts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapFilter]);

  async function loadProducts() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("products")
      .select(
        "id, name, category, price, cost_price, image_url, stock, active, blocked_by_hub, promo_buy_qty, promo_pay_qty, barcode, price_fiado, price_wholesale, wholesale_min_qty, stock_alert_threshold, expiry_date, supplier, on_offer, offer_price, offer_ends_at, sold_by_weight, created_at",
      )
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    setProducts(data ?? []);
    setLoading(false);
  }

  async function loadStats() {
    const { data } = await getSupabase().rpc("product_sales_stats", { p_store_id: store.id, p_days: 30 });
    if (!data) return;
    const map: Record<string, SalesStat> = {};
    for (const row of data as (SalesStat & { product_id: string })[]) {
      map[row.product_id] = row;
    }
    setStats(map);
  }

  async function loadMovements(productId: string) {
    const { data } = await getSupabase()
      .from("stock_movements")
      .select("id, type, quantity, unit_cost, note, created_by, created_at")
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(10);
    setMovements((prev) => ({ ...prev, [productId]: data ?? [] }));
  }

  const [kitUsage, setKitUsage] = useState<Record<string, string[]>>({});

  async function loadKitUsage() {
    const { data } = await getSupabase()
      .from("kits")
      .select("name, kit_items(product_id)")
      .eq("store_id", store.id)
      .eq("active", true);
    const map: Record<string, string[]> = {};
    for (const k of (data as { name: string; kit_items: { product_id: string }[] }[]) ?? []) {
      for (const item of k.kit_items) {
        (map[item.product_id] ??= []).push(k.name);
      }
    }
    setKitUsage(map);
  }

  useEffect(() => {
    loadProducts();
    loadStats();
    loadKitUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const restockGroups = useMemo(() => {
    const low = products.filter((p) => p.active && p.stock <= p.stock_alert_threshold);
    const groups = new Map<string, Product[]>();
    for (const p of low) {
      const key = p.supplier?.trim() || "Sem fornecedor definido";
      const list = groups.get(key) ?? [];
      list.push(p);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [products]);

  function openWhatsAppRestock(supplierName: string, items: Product[]) {
    const lines = items.map((p) => {
      const kitNote = kitUsage[p.id]?.length ? ` (também usado no kit "${kitUsage[p.id].join('", "')}")` : "";
      const stockLabel = p.sold_by_weight ? `${p.stock.toFixed(3)}kg` : `${p.stock}`;
      return `- ${p.name}: só ${stockLabel} (mínimo ${p.stock_alert_threshold})${kitNote}`;
    });
    const text = `Lista de reposição — ${store.name}\nFornecedor: ${supplierName}\n\n${lines.join("\n")}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const priceValue = Number(price.replace(",", "."));
    const stockValue = Number(stock);
    const costValue = costPrice.trim() ? Number(costPrice.replace(",", ".")) : null;
    if (!name.trim() || Number.isNaN(priceValue) || priceValue < 0) {
      setError("Preencha o nome e um preço válido.");
      return;
    }

    const similar = similarProduct(name, products);
    if (similar) {
      if (!window.confirm(`Já existe um produto parecido: "${similar.name}". Cadastrar mesmo assim?`)) return;
    }

    const trimmedBarcode = barcode.trim();
    if (trimmedBarcode) {
      const dupe = products.find((p) => p.barcode === trimmedBarcode);
      if (dupe) {
        if (!window.confirm(`Esse código de barras já está no produto "${dupe.name}". Cadastrar mesmo assim?`)) return;
      }
    }

    if (costValue !== null && !Number.isNaN(costValue) && priceValue <= costValue) {
      if (!window.confirm(`O preço de venda (${formatCurrency(priceValue)}) não é maior que o custo (${formatCurrency(costValue)}) — você vai vender no prejuízo. Cadastrar mesmo assim?`)) return;
    }

    const wholesaleRaw = wholesalePriceNew.trim() ? Number(wholesalePriceNew.replace(",", ".")) : null;
    const wholesalePriceValue =
      wholesaleRaw === null
        ? null
        : wholesaleModeNew === "percentual"
          ? Math.round(priceValue * (1 - wholesaleRaw / 100) * 100) / 100
          : wholesaleRaw;
    const wholesaleMinQtyValue = wholesaleMinQtyNew.trim() ? Number(wholesaleMinQtyNew) : null;
    if (wholesalePriceValue !== null || wholesaleMinQtyValue !== null) {
      if (
        !wholesalePriceValue ||
        !wholesaleMinQtyValue ||
        Number.isNaN(wholesalePriceValue) ||
        Number.isNaN(wholesaleMinQtyValue) ||
        wholesalePriceValue >= priceValue ||
        wholesalePriceValue <= 0
      ) {
        setError('Preencha "Preço atacado" e "A partir de quantos" válidos, com o preço atacado menor que o preço normal.');
        return;
      }
    }

    setSaving(true);
    const { error: insertError } = await getSupabase().from("products").insert({
      store_id: store.id,
      name: name.trim(),
      category: category.trim() || null,
      price: priceValue,
      cost_price: costValue !== null && !Number.isNaN(costValue) ? costValue : null,
      stock: Number.isNaN(stockValue) ? 0 : stockValue,
      image_url: imageUrl.trim() || null,
      barcode: barcode.trim() || null,
      expiry_date: expiryDate || null,
      supplier: supplier.trim() || null,
      sold_by_weight: soldByWeight,
      price_wholesale: wholesalePriceValue,
      wholesale_min_qty: wholesaleMinQtyValue,
    });
    setSaving(false);

    if (insertError) {
      setError("Não deu pra salvar o produto: " + insertError.message);
      return;
    }

    setName("");
    setCategory("");
    setPrice("");
    setCostPrice("");
    setDesiredMarkup("");
    setExpiryDate("");
    setSupplier("");
    setStock("");
    setImageUrl("");
    setBarcode("");
    setSoldByWeight(false);
    setWholesalePriceNew("");
    setWholesaleMinQtyNew("");
    loadProducts();
  }

  async function updateProduct(id: string, patch: Partial<Product>) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    await getSupabase().from("products").update(patch).eq("id", id);
  }

  function promoDraftFor(p: Product) {
    return (
      promoDrafts[p.id] ?? {
        buy: p.promo_buy_qty ? String(p.promo_buy_qty) : "",
        pay: p.promo_pay_qty ? String(p.promo_pay_qty) : "",
      }
    );
  }

  async function handleSavePromo(p: Product) {
    const draft = promoDraftFor(p);
    const buy = draft.buy.trim() ? Number(draft.buy) : null;
    const pay = draft.pay.trim() ? Number(draft.pay) : null;

    if (buy === null && pay === null) {
      await updateProduct(p.id, { promo_buy_qty: null, promo_pay_qty: null });
      setPromoDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      return;
    }

    if (!buy || !pay || buy <= pay) {
      window.alert('Preencha "Leve" e "Pague" com números válidos, sendo "Leve" maior que "Pague".');
      return;
    }

    await updateProduct(p.id, { promo_buy_qty: buy, promo_pay_qty: pay });
    setPromoDrafts((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
  }

  function wholesaleDraftFor(p: Product) {
    return (
      wholesaleDrafts[p.id] ?? {
        price: p.price_wholesale ? String(p.price_wholesale) : "",
        minQty: p.wholesale_min_qty ? String(p.wholesale_min_qty) : "",
        mode: "valor" as const,
      }
    );
  }

  async function handleSaveWholesale(p: Product) {
    const draft = wholesaleDraftFor(p);
    const rawPrice = draft.price.trim() ? Number(draft.price.replace(",", ".")) : null;
    const wholesalePrice =
      rawPrice === null
        ? null
        : draft.mode === "percentual"
          ? Math.round(p.price * (1 - rawPrice / 100) * 100) / 100
          : rawPrice;
    const minQty = draft.minQty.trim() ? Number(draft.minQty) : null;

    if (wholesalePrice === null && minQty === null) {
      await updateProduct(p.id, { price_wholesale: null, wholesale_min_qty: null });
      setWholesaleDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      return;
    }

    if (!wholesalePrice || !minQty || wholesalePrice >= p.price || wholesalePrice <= 0) {
      window.alert(
        'Preencha "Preço atacado" e "Qtd mínima" válidos, sendo o preço atacado menor que o preço normal.',
      );
      return;
    }

    await updateProduct(p.id, { price_wholesale: wholesalePrice, wholesale_min_qty: minQty });
    setWholesaleDrafts((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
  }

  function offerUiOpenFor(p: Product) {
    return offerUiOpen[p.id] ?? p.on_offer;
  }

  function offerDraftFor(p: Product) {
    return offerDrafts[p.id] ?? (p.offer_price ? String(p.offer_price) : "");
  }

  function offerEndsAtDraftFor(p: Product) {
    if (offerEndsAtDrafts[p.id] !== undefined) return offerEndsAtDrafts[p.id];
    return p.offer_ends_at ? p.offer_ends_at.slice(0, 10) : "";
  }

  function handleToggleOfferUi(p: Product, checked: boolean) {
    setOfferUiOpen((prev) => ({ ...prev, [p.id]: checked }));
    if (!checked && p.on_offer) {
      updateProduct(p.id, { on_offer: false, offer_price: null, offer_ends_at: null });
      setOfferDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      setOfferEndsAtDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
    }
  }

  async function handleSaveOfferPrice(p: Product) {
    const raw = offerDraftFor(p).trim();
    const value = raw ? Number(raw.replace(",", ".")) : null;
    if (!value || Number.isNaN(value) || value <= 0 || value >= p.price) {
      window.alert('Preço da oferta precisa ser um número válido, menor que o preço normal.');
      return;
    }
    const endsAtRaw = offerEndsAtDraftFor(p).trim();
    const offerEndsAt = endsAtRaw ? new Date(`${endsAtRaw}T23:59:59`).toISOString() : null;
    await updateProduct(p.id, { on_offer: true, offer_price: value, offer_ends_at: offerEndsAt });
  }

  async function deleteProduct(id: string, productName: string) {
    if (!window.confirm(`Excluir "${productName}"? Essa ação não pode ser desfeita.`)) return;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    await getSupabase().from("products").delete().eq("id", id);
  }

  const CSV_HEADER = [
    "nome",
    "categoria",
    "preco",
    "estoque",
    "preco_custo",
    "codigo_barras",
    "por_peso",
    "preco_atacado",
    "qtd_minima_atacado",
    "preco_fiado",
    "leve",
    "pague",
    "fornecedor",
    "validade",
    "alerta_estoque",
  ];

  function exportCsv() {
    const lines = [CSV_HEADER.join(",")];
    for (const p of products) {
      lines.push(
        [
          toCsvValue(p.name),
          toCsvValue(p.category ?? ""),
          String(p.price),
          String(p.stock),
          p.cost_price !== null ? String(p.cost_price) : "",
          toCsvValue(p.barcode ?? ""),
          p.sold_by_weight ? "sim" : "nao",
          p.price_wholesale !== null ? String(p.price_wholesale) : "",
          p.wholesale_min_qty !== null ? String(p.wholesale_min_qty) : "",
          p.price_fiado !== null ? String(p.price_fiado) : "",
          p.promo_buy_qty !== null ? String(p.promo_buy_qty) : "",
          p.promo_pay_qty !== null ? String(p.promo_pay_qty) : "",
          toCsvValue(p.supplier ?? ""),
          p.expiry_date ?? "",
          String(p.stock_alert_threshold),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `produtos-${store.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDuplicate(p: Product) {
    setDuplicating(p.id);
    const { error: insertError } = await getSupabase()
      .from("products")
      .insert({
        store_id: store.id,
        name: `${p.name} (cópia)`,
        category: p.category,
        price: p.price,
        cost_price: p.cost_price,
        stock: 0,
        image_url: p.image_url,
        barcode: null,
        price_fiado: p.price_fiado,
        price_wholesale: p.price_wholesale,
        wholesale_min_qty: p.wholesale_min_qty,
        promo_buy_qty: p.promo_buy_qty,
        promo_pay_qty: p.promo_pay_qty,
        stock_alert_threshold: p.stock_alert_threshold,
        supplier: p.supplier,
        sold_by_weight: p.sold_by_weight,
      });
    setDuplicating(null);
    if (insertError) {
      setError("Não deu pra duplicar: " + insertError.message);
      return;
    }
    loadProducts();
  }

  function lossDraftFor(id: string) {
    return lossDrafts[id] ?? { type: "quebra" as StockMovement["type"], quantity: "", note: "" };
  }

  async function handleRegisterLoss(p: Product) {
    const draft = lossDraftFor(p.id);
    const qty = Number(draft.quantity.replace(",", "."));
    if (!qty || Number.isNaN(qty) || qty <= 0) {
      window.alert("Informe uma quantidade válida pra baixa.");
      return;
    }
    setSavingLoss(p.id);
    const { error: rpcError } = await getSupabase().rpc("register_stock_loss", {
      p_store_id: store.id,
      p_product_id: p.id,
      p_type: draft.type,
      p_quantity: qty,
      p_note: draft.note.trim() || null,
    });
    setSavingLoss(null);
    if (rpcError) {
      window.alert("Não deu pra registrar a baixa: " + rpcError.message);
      return;
    }
    setLossDrafts((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    loadProducts();
    loadMovements(p.id);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkAdjust() {
    const percent = Number(adjustPercent.replace(",", "."));
    if (!percent || Number.isNaN(percent)) {
      window.alert("Informe uma porcentagem diferente de zero (ex: 8 ou -5).");
      return;
    }
    const scope = adjustCategory ? `a categoria "${adjustCategory}"` : "TODOS os produtos";
    if (!window.confirm(`Reajustar ${scope} em ${percent > 0 ? "+" : ""}${percent}%?`)) return;

    setAdjustingPrices(true);
    setAdjustResult(null);
    const { data, error: rpcError } = await getSupabase().rpc("bulk_price_adjust", {
      p_store_id: store.id,
      p_percent: percent,
      p_category: adjustCategory || null,
    });
    setAdjustingPrices(false);
    if (rpcError) {
      setAdjustResult("Não deu pra reajustar: " + rpcError.message);
      return;
    }
    setAdjustResult(`${data} produto${data === 1 ? "" : "s"} reajustado${data === 1 ? "" : "s"}.`);
    setAdjustPercent("");
    loadProducts();
  }

  function printLabels(list: Product[], forceOffer: boolean) {
    if (list.length === 0) return;

    const labels = list
      .map((p) => {
        const isOffer = forceOffer && p.on_offer && p.offer_price !== null;
        const pctOff = isOffer ? Math.round(((p.price - p.offer_price!) / p.price) * 100) : null;
        const unitLabel = p.sold_by_weight ? "/kg" : "un.";
        return `
        <div class="label">
          <p class="name">${p.name}</p>
          ${
            isOffer
              ? `<p class="old-price">${formatCurrency(p.price)}</p>
                 <p class="price offer">${formatCurrency(p.offer_price!)} <span class="unit">${unitLabel}</span></p>
                 <p class="pct">-${pctOff}%</p>`
              : `<p class="price">${formatCurrency(p.price)} <span class="unit">${unitLabel}</span></p>`
          }
          ${p.price_wholesale && p.wholesale_min_qty ? `<p class="wholesale">${p.wholesale_min_qty}+ un: ${formatCurrency(p.price_wholesale)} cada</p>` : ""}
        </div>`;
      })
      .join("");

    // Uma etiqueta por página — pra impressora térmica tipo Epson TM-T20X
    // (rolo de 58mm) cortar cada uma sozinha, sem precisar de tesoura.
    const win = window.open("", "_blank", "width=380,height=600");
    if (!win) return;
    win.document.write(`
      <html><head><title>Etiquetas</title>
      <style>
        @page { size: 58mm auto; margin: 1.5mm; }
        * { box-sizing: border-box; }
        body{font-family:sans-serif;margin:0;padding:0;}
        .label{width:55mm;text-align:center;padding:2mm 3mm;page-break-after:always;break-after:page;}
        .label:last-child{page-break-after:auto;break-after:auto;}
        .name{font-size:14px;font-weight:600;margin:0 0 1.5mm;}
        .price{font-size:24px;font-weight:bold;margin:1mm 0;}
        .price .unit{font-size:12px;font-weight:normal;}
        .old-price{font-size:12px;color:#888;text-decoration:line-through;margin:0;}
        .price.offer{color:#b91c1c;}
        .pct{font-size:13px;font-weight:bold;color:#b91c1c;margin:0 0 1mm;}
        .wholesale{font-size:10px;color:#555;margin:1mm 0;}
      </style></head><body>
      ${labels}
      <script>window.print();</script>
      </body></html>
    `);
    win.document.close();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImporting(true);
    setImportMessage(null);
    setError(null);

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      setImporting(false);
      setError("O arquivo CSV está vazio.");
      return;
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {
      name: header.indexOf("nome"),
      category: header.indexOf("categoria"),
      price: header.indexOf("preco"),
      stock: header.indexOf("estoque"),
      costPrice: header.indexOf("preco_custo"),
      barcode: header.indexOf("codigo_barras"),
      soldByWeight: header.indexOf("por_peso"),
      wholesalePrice: header.indexOf("preco_atacado"),
      wholesaleMinQty: header.indexOf("qtd_minima_atacado"),
      priceFiado: header.indexOf("preco_fiado"),
      promoBuy: header.indexOf("leve"),
      promoPay: header.indexOf("pague"),
      supplier: header.indexOf("fornecedor"),
      expiryDate: header.indexOf("validade"),
      alertThreshold: header.indexOf("alerta_estoque"),
    };

    if (idx.name === -1 || idx.price === -1) {
      setImporting(false);
      setError('CSV precisa ter pelo menos as colunas "nome" e "preco".');
      return;
    }

    const supabase = getSupabase();
    const existingByName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
    // Casa por código de barras primeiro quando a planilha traz um — assim
    // reimportar depois de renomear um produto (ex: fornecedor mudou o nome)
    // atualiza o mesmo produto em vez de criar um duplicado.
    const existingByBarcode = new Map(
      products.filter((p) => p.barcode).map((p) => [p.barcode!.trim(), p]),
    );

    const numAt = (row: string[], col: number) => {
      if (col === -1) return undefined;
      const raw = (row[col] ?? "").trim();
      if (!raw) return null;
      const v = Number(raw.replace(",", "."));
      return Number.isNaN(v) ? undefined : v;
    };
    const textAt = (row: string[], col: number) => {
      if (col === -1) return undefined;
      const raw = (row[col] ?? "").trim();
      return raw || null;
    };

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows.slice(1)) {
      const rowName = (row[idx.name] ?? "").trim();
      const priceValue = Number((row[idx.price] ?? "").replace(",", "."));
      if (!rowName || Number.isNaN(priceValue) || priceValue < 0) {
        skipped++;
        continue;
      }

      const stockValue = numAt(row, idx.stock);
      const costValue = numAt(row, idx.costPrice);
      const categoryValue = textAt(row, idx.category);
      const barcodeValue = textAt(row, idx.barcode);
      const soldByWeightRaw = idx.soldByWeight !== -1 ? (row[idx.soldByWeight] ?? "").trim().toLowerCase() : "";
      const wholesalePriceValue = numAt(row, idx.wholesalePrice);
      const wholesaleMinQtyValue = numAt(row, idx.wholesaleMinQty);
      const priceFiadoValue = numAt(row, idx.priceFiado);
      const promoBuyValue = numAt(row, idx.promoBuy);
      const promoPayValue = numAt(row, idx.promoPay);
      const supplierValue = textAt(row, idx.supplier);
      const expiryDateValue = idx.expiryDate !== -1 ? (row[idx.expiryDate] ?? "").trim() || null : undefined;
      const alertThresholdValue = numAt(row, idx.alertThreshold);

      const extra: Record<string, unknown> = {};
      if (barcodeValue !== undefined) extra.barcode = barcodeValue;
      if (idx.soldByWeight !== -1) extra.sold_by_weight = soldByWeightRaw === "sim";
      if (wholesalePriceValue !== undefined) extra.price_wholesale = wholesalePriceValue;
      if (wholesaleMinQtyValue !== undefined) extra.wholesale_min_qty = wholesaleMinQtyValue;
      if (priceFiadoValue !== undefined) extra.price_fiado = priceFiadoValue;
      if (promoBuyValue !== undefined) extra.promo_buy_qty = promoBuyValue;
      if (promoPayValue !== undefined) extra.promo_pay_qty = promoPayValue;
      if (supplierValue !== undefined) extra.supplier = supplierValue;
      if (expiryDateValue !== undefined) extra.expiry_date = expiryDateValue;
      if (alertThresholdValue !== undefined && alertThresholdValue !== null) extra.stock_alert_threshold = alertThresholdValue;

      const existing =
        (barcodeValue ? existingByBarcode.get(barcodeValue.trim()) : undefined) ??
        existingByName.get(rowName.toLowerCase());
      if (existing) {
        // Inclui o nome no patch pra quando o casamento foi por código de
        // barras e o nome na planilha mudou (fornecedor renomeou) — sem
        // isso o produto ficava com o nome antigo pra sempre.
        const patch: Record<string, unknown> = { name: rowName, price: priceValue, ...extra };
        if (stockValue !== undefined && stockValue !== null) patch.stock = stockValue;
        if (costValue !== undefined) patch.cost_price = costValue;
        if (categoryValue) patch.category = categoryValue;
        await supabase.from("products").update(patch).eq("id", existing.id);
        updated++;
      } else {
        await supabase.from("products").insert({
          store_id: store.id,
          name: rowName,
          category: categoryValue || null,
          price: priceValue,
          stock: stockValue ?? 0,
          cost_price: costValue ?? null,
          ...extra,
        });
        created++;
      }
    }

    setImporting(false);
    setImportMessage(
      `Importação concluída: ${created} produto${created === 1 ? "" : "s"} criado${created === 1 ? "" : "s"}, ${updated} atualizado${updated === 1 ? "" : "s"}${skipped > 0 ? `, ${skipped} linha${skipped === 1 ? "" : "s"} ignorada${skipped === 1 ? "" : "s"} (sem nome ou preço válido)` : ""}.`,
    );
    loadProducts();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Produtos</h1>

      <form
        onSubmit={handleAdd}
        className="mt-4 space-y-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              1. Código de barras (opcional)
            </label>
            <div className="mt-1 flex items-center gap-1">
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onBlur={(e) => lookupBarcodeProduct(e.target.value)}
                placeholder="Escaneie ou digite primeiro"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
              <button
                type="button"
                onClick={openBarcodeScanner}
                title="Ler código de barras com a câmera"
                className="shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-700"
              >
                📷
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">2. Nome do produto</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setBarcodeLookupResult(null);
              }}
              placeholder="Nome do produto"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
            {lookingUpBarcode && (
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">🔎 procurando esse produto…</p>
            )}
            {barcodeLookupResult === "achou" && (
              <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                ✅ preenchido automaticamente, confira se está certo
              </p>
            )}
            {barcodeLookupResult === "nao_achou" && (
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                não achei esse produto, digite o nome
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Categoria</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Categoria"
              list="categorias-existentes"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
            <datalist id="categorias-existentes">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Preço</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Preço de venda (R$)</label>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="R$"
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Custo (opcional)</label>
              <input
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="R$"
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                Ou: % que eu quero ganhar
              </label>
              <input
                value={desiredMarkup}
                onChange={(e) => {
                  const raw = e.target.value;
                  setDesiredMarkup(raw);
                  const c = Number(costPrice.replace(",", "."));
                  const pct = Number(raw.replace(",", "."));
                  if (raw.trim() !== "" && c > 0 && !Number.isNaN(c) && !Number.isNaN(pct) && pct >= 0) {
                    setPrice((c * (1 + pct / 100)).toFixed(2));
                  }
                }}
                placeholder={costPrice.trim() ? "%" : "preencha o custo primeiro"}
                inputMode="decimal"
                disabled={!costPrice.trim()}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>
          </div>
          {(() => {
            const p = Number(price.replace(",", "."));
            const c = Number(costPrice.replace(",", "."));
            const priceOk = p > 0 && !Number.isNaN(p);
            const costOk = c > 0 && !Number.isNaN(c);
            if (!priceOk) return null;
            if (!costOk) {
              return (
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                  preencha o custo pra ver a margem
                </p>
              );
            }
            const margin = ((p - c) / p) * 100;
            const markup = ((p - c) / c) * 100;
            return (
              <p className="mt-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                margem {margin.toFixed(0)}% · markup {markup.toFixed(0)}%
              </p>
            );
          })()}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Estoque</p>
          <div className="mt-2 grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                {soldByWeight ? "Estoque (kg)" : "Estoque"}
              </label>
              <input
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:pb-2 dark:text-slate-300">
              <input
                type="checkbox"
                checked={soldByWeight}
                onChange={(e) => setSoldByWeight(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              ⚖️ Vendido por peso (kg)
            </label>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Atacado (opcional)
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Preço atacado</label>
              <div className="mt-1 flex items-center gap-1">
                <select
                  value={wholesaleModeNew}
                  onChange={(e) => setWholesaleModeNew(e.target.value as "valor" | "percentual")}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                >
                  <option value="valor">R$</option>
                  <option value="percentual">%</option>
                </select>
                <input
                  value={wholesalePriceNew}
                  onChange={(e) => setWholesalePriceNew(e.target.value)}
                  placeholder={wholesaleModeNew === "percentual" ? "ex: 10" : "R$"}
                  inputMode="decimal"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                />
              </div>
              {wholesaleModeNew === "percentual" && price && wholesalePriceNew.trim() && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  = {formatCurrency(
                    Math.round(
                      Number(price.replace(",", ".")) *
                        (1 - Number(wholesalePriceNew.replace(",", ".")) / 100) *
                        100,
                    ) / 100,
                  )}{" "}
                  no atacado
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                Sai em atacado a partir de quantos
              </label>
              <input
                value={wholesaleMinQtyNew}
                onChange={(e) => setWholesaleMinQtyNew(e.target.value)}
                placeholder="ex: 12"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Fornecedor (opcional)</label>
            <input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Fornecedor"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              Validade (opcional, pra perecíveis)
            </label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Foto</p>
          <div className="mt-2">
            <PhotoField
              storeId={store.id}
              value={imageUrl}
              onChange={setImageUrl}
              uploadPrefix="produto"
              promptSeed={buildProductPrompt(name || "produto novo", category || null)}
              catalogProducts={products.filter((p) => p.image_url)}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {saving ? "Salvando…" : "Adicionar produto"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {scanningBarcode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 dark:bg-slate-900">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
              Aponte a câmera pro código de barras
            </p>
            {scanError ? (
              <p className="mt-2 text-sm text-red-600">{scanError}</p>
            ) : (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video ref={scanVideoRef} className="mt-2 w-full rounded-lg bg-black" muted playsInline />
            )}
            <button
              type="button"
              onClick={closeBarcodeScanner}
              className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {(catalogGaps.withoutPhoto > 0 || catalogGaps.withoutCost > 0 || catalogGaps.withoutCategory > 0) && (
        <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-900/30">
          <p className="text-sm text-amber-800 dark:text-amber-400">📋 Falta completar o catálogo — clique pra ver e corrigir:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {catalogGaps.withoutPhoto > 0 && (
              <button
                type="button"
                onClick={() => jumpToGap("photo")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  gapFilter === "photo"
                    ? "bg-amber-700 text-white"
                    : "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-300"
                }`}
              >
                📷 {catalogGaps.withoutPhoto} sem foto
              </button>
            )}
            {catalogGaps.withoutCost > 0 && (
              <button
                type="button"
                onClick={() => jumpToGap("cost")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  gapFilter === "cost"
                    ? "bg-amber-700 text-white"
                    : "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-300"
                }`}
              >
                💰 {catalogGaps.withoutCost} sem custo
              </button>
            )}
            {catalogGaps.withoutCategory > 0 && (
              <button
                type="button"
                onClick={() => jumpToGap("category")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  gapFilter === "category"
                    ? "bg-amber-700 text-white"
                    : "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-300"
                }`}
              >
                🏷️ {catalogGaps.withoutCategory} sem categoria
              </button>
            )}
            {gapFilter && (
              <button
                type="button"
                onClick={() => setGapFilter(null)}
                className="rounded-full px-3 py-1 text-xs font-medium text-amber-700 underline dark:text-amber-400"
              >
                ✕ limpar filtro
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, categoria ou código de barras…"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <button
          onClick={exportCsv}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
        >
          Exportar CSV
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
        >
          {importing ? "Importando…" : "Importar CSV"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleImportFile}
          className="hidden"
        />
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Colunas do CSV: nome, categoria, preco, estoque, preco_custo, codigo_barras, por_peso (sim/nao),
        preco_atacado, qtd_minima_atacado, preco_fiado, leve, pague, fornecedor, validade, alerta_estoque —
        produto existente (mesmo nome) é atualizado, o resto é criado.
      </p>
      {importMessage && <p className="mt-2 text-sm text-green-700 dark:text-green-400">{importMessage}</p>}

      <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Reajuste de preço em massa
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={adjustCategory}
            onChange={(e) => setAdjustCategory(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          >
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            value={adjustPercent}
            onChange={(e) => setAdjustPercent(e.target.value)}
            placeholder="% (ex: 8 ou -5)"
            inputMode="decimal"
            className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          <button
            onClick={handleBulkAdjust}
            disabled={adjustingPrices}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {adjustingPrices ? "Aplicando…" : "Aplicar reajuste"}
          </button>
        </div>
        {adjustResult && <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{adjustResult}</p>}
      </details>

      {restockGroups.length > 0 && (
        <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            📋 Lista de compras pro fornecedor ({restockGroups.reduce((sum, [, items]) => sum + items.length, 0)} produto(s) com
            estoque baixo)
          </summary>
          <div className="mt-3 space-y-3">
            {restockGroups.map(([supplierName, items]) => (
              <div key={supplierName} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{supplierName}</p>
                  <button
                    onClick={() => openWhatsAppRestock(supplierName, items)}
                    className="text-xs font-medium text-green-700 underline dark:text-green-400"
                  >
                    📱 Enviar por WhatsApp
                  </button>
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                  {items.map((p) => (
                    <li key={p.id}>
                      {p.name}: só {p.sold_by_weight ? p.stock.toFixed(3) : p.stock} (mínimo {p.stock_alert_threshold})
                      {kitUsage[p.id]?.length ? ` — também usado no kit "${kitUsage[p.id].join('", "')}"` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {selectedIds.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 dark:bg-blue-900/20">
          <span className="text-sm text-blue-900 dark:text-blue-300">{selectedIds.size} selecionado(s)</span>
          <button
            onClick={() => printLabels(products.filter((p) => selectedIds.has(p.id)), false)}
            className="text-sm font-medium text-blue-900 underline dark:text-blue-400"
          >
            🖨️ Imprimir etiquetas
          </button>
          <button
            onClick={() => printLabels(products.filter((p) => selectedIds.has(p.id)), true)}
            className="text-sm font-medium text-blue-900 underline dark:text-blue-400"
          >
            🏷️ Imprimir etiquetas de promoção
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-slate-500 underline dark:text-slate-400"
          >
            Limpar seleção
          </button>
        </div>
      )}

      <div ref={productsTableRef} className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 font-medium"></th>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Preço</th>
              <th className="px-3 py-2 font-medium">Custo</th>
              <th className="px-3 py-2 font-medium">Margem / markup</th>
              <th className="px-3 py-2 font-medium">Estoque</th>
              <th className="px-3 py-2 font-medium">Por peso?</th>
              <th className="px-3 py-2 font-medium">Promoção (leve/pague)</th>
              <th className="px-3 py-2 font-medium">Alertas</th>
              <th className="px-3 py-2 font-medium">Ativo</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {loading && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && filteredProducts.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  {products.length === 0 ? "Nenhum produto cadastrado ainda." : "Nenhum produto encontrado pra essa busca."}
                </td>
              </tr>
            )}
            {filteredProducts.map((p) => {
              const margin = p.cost_price && p.price > 0 ? ((p.price - p.cost_price) / p.price) * 100 : null;
              const markup = p.cost_price && p.cost_price > 0 ? ((p.price - p.cost_price) / p.cost_price) * 100 : null;
              const stat = stats[p.id];
              const isNew = daysSince(p.created_at) <= 7;
              const isStalled = stat && stat.last_sold_at && daysSince(stat.last_sold_at) > 30;
              const neverSold = stat && !stat.last_sold_at;
              const daysToStockout =
                stat && stat.avg_daily_sales > 0 ? Math.floor(p.stock / stat.avg_daily_sales) : null;
              const priceIncoherent =
                (p.price_wholesale !== null && p.price_wholesale >= p.price) ||
                (p.offer_price !== null && p.offer_price >= p.price);
              const expiryWarning = p.expiry_date ? daysUntil(p.expiry_date) : null;
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-900 dark:text-slate-50">
                    <p>
                      {p.name}
                      {isNew && (
                        <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                          🆕 novo
                        </span>
                      )}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <button
                        onClick={() => printLabels([p], false)}
                        className="text-xs font-medium text-blue-900 hover:underline dark:text-blue-400"
                      >
                        🏷️ Etiqueta
                      </button>
                      <button
                        onClick={() => handleDuplicate(p)}
                        disabled={duplicating === p.id}
                        className="text-xs font-medium text-blue-900 hover:underline disabled:opacity-60 dark:text-blue-400"
                      >
                        {duplicating === p.id ? "duplicando…" : "📋 Duplicar"}
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      key={`category-${p.id}-${p.category}`}
                      defaultValue={p.category ?? ""}
                      list="categorias-existentes"
                      placeholder="sem categoria"
                      onBlur={(e) => updateProduct(p.id, { category: e.target.value.trim() || null })}
                      className={`w-28 rounded border px-2 py-1 dark:bg-slate-900 ${
                        p.category
                          ? "border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:text-slate-50"
                          : "border-amber-300 bg-amber-50 text-amber-800 placeholder:text-amber-500 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      key={`price-${p.id}-${p.price}`}
                      type="number"
                      step="0.01"
                      defaultValue={p.price}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v) && v >= 0) updateProduct(p.id, { price: v });
                      }}
                      className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      key={`cost-${p.id}-${p.cost_price}`}
                      type="number"
                      step="0.01"
                      defaultValue={p.cost_price ?? ""}
                      placeholder="—"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const v = raw ? Number(raw) : null;
                        if (v === null || (!Number.isNaN(v) && v >= 0)) updateProduct(p.id, { cost_price: v });
                      }}
                      className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {margin !== null ? (
                      <>
                        <p className={margin < 10 ? "font-medium text-red-600 dark:text-red-400" : ""}>
                          margem {margin.toFixed(0)}%
                        </p>
                        <p className="text-xs text-slate-400">markup {markup !== null ? `${markup.toFixed(0)}%` : "—"}</p>
                        {p.price <= (p.cost_price ?? 0) && (
                          <p className="text-xs font-semibold text-red-600 dark:text-red-400">⚠️ no prejuízo</p>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      key={`stock-${p.id}-${p.stock}`}
                      type="number"
                      step={p.sold_by_weight ? "0.001" : "1"}
                      defaultValue={p.stock}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v) && v >= 0) updateProduct(p.id, { stock: v });
                      }}
                      className={`w-20 rounded border px-2 py-1 dark:bg-slate-900 ${
                        p.stock <= p.stock_alert_threshold
                          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:text-red-400"
                          : "border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:text-slate-50"
                      }`}
                    />
                    {p.stock <= p.stock_alert_threshold && (
                      <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">estoque baixo</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={p.sold_by_weight}
                      onChange={(e) => updateProduct(p.id, { sold_by_weight: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {p.sold_by_weight && (
                      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">⚖️ kg</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        placeholder="Leve"
                        value={promoDraftFor(p).buy}
                        onChange={(e) =>
                          setPromoDrafts((prev) => ({
                            ...prev,
                            [p.id]: { ...promoDraftFor(p), buy: e.target.value },
                          }))
                        }
                        className="w-14 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                      <input
                        type="number"
                        min={1}
                        placeholder="Pague"
                        value={promoDraftFor(p).pay}
                        onChange={(e) =>
                          setPromoDrafts((prev) => ({
                            ...prev,
                            [p.id]: { ...promoDraftFor(p), pay: e.target.value },
                          }))
                        }
                        className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                      <button
                        onClick={() => handleSavePromo(p)}
                        className="text-xs font-medium text-blue-900 hover:underline dark:text-blue-400"
                      >
                        Salvar
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 space-y-0.5">
                    {expiryWarning !== null && expiryWarning <= 7 && (
                      <p className={`text-[10px] font-medium ${expiryWarning < 0 ? "text-red-600" : "text-amber-600"} dark:text-amber-400`}>
                        {expiryWarning < 0 ? "⏰ venceu" : `⏰ vence em ${expiryWarning}d`}
                      </p>
                    )}
                    {priceIncoherent && (
                      <p className="text-[10px] font-medium text-red-600 dark:text-red-400">⚠️ preço incoerente</p>
                    )}
                    {isStalled && (
                      <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                        😴 parado há {daysSince(stat!.last_sold_at!)}d
                      </p>
                    )}
                    {neverSold && !isNew && (
                      <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">😴 nunca vendeu</p>
                    )}
                    {daysToStockout !== null && daysToStockout <= 5 && (
                      <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        📉 acaba em ~{daysToStockout}d
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => updateProduct(p.id, { active: !p.active })}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        p.active
                          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                          : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {p.active ? "Ativo" : "Inativo"}
                    </button>
                    {p.blocked_by_hub && (
                      <p
                        className="mt-1 text-[10px] font-semibold text-red-600 dark:text-red-400"
                        title="A plataforma bloqueou esse produto — mesmo ativado aqui, ele não aparece no site até o Hub liberar."
                      >
                        🚫 bloqueado pelo Hub
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => {
                        const next = expandedId === p.id ? null : p.id;
                        setExpandedId(next);
                        if (next) loadMovements(p.id);
                      }}
                      className="mr-2 text-xs font-medium text-blue-900 hover:underline dark:text-blue-400"
                    >
                      {expandedId === p.id ? "Fechar" : "Detalhes"}
                    </button>
                    <button
                      onClick={() => deleteProduct(p.id, p.name)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              );
            })}
            {filteredProducts.map(
              (p) =>
                expandedId === p.id && (
                  <tr key={`${p.id}-detalhes`}>
                    <td colSpan={12} className="bg-slate-50 px-4 py-4 dark:bg-slate-800/50">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            Foto
                          </label>
                          <div className="mt-1">
                            <PhotoField
                              storeId={store.id}
                              value={p.image_url ?? ""}
                              onChange={(url) => updateProduct(p.id, { image_url: url })}
                              uploadPrefix="produto"
                              promptSeed={buildProductPrompt(p.name, p.category)}
                              catalogProducts={products.filter((other) => other.id !== p.id && other.image_url)}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            Código de barras
                          </label>
                          <input
                            key={`barcode-${p.id}-${p.barcode}`}
                            defaultValue={p.barcode ?? ""}
                            onBlur={(e) => {
                              const v = e.target.value.trim() || null;
                              if (v) {
                                const dupe = products.find((other) => other.id !== p.id && other.barcode === v);
                                if (dupe && !window.confirm(`Esse código já está no produto "${dupe.name}". Salvar mesmo assim?`)) {
                                  e.target.value = p.barcode ?? "";
                                  return;
                                }
                              }
                              updateProduct(p.id, { barcode: v });
                            }}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            Fornecedor
                          </label>
                          <input
                            key={`supplier-${p.id}-${p.supplier}`}
                            defaultValue={p.supplier ?? ""}
                            onBlur={(e) => updateProduct(p.id, { supplier: e.target.value.trim() || null })}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            Validade
                          </label>
                          <input
                            key={`expiry-${p.id}-${p.expiry_date}`}
                            type="date"
                            defaultValue={p.expiry_date ?? ""}
                            onBlur={(e) => updateProduct(p.id, { expiry_date: e.target.value || null })}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            Preço fiado (R$)
                          </label>
                          <input
                            key={`fiado-${p.id}-${p.price_fiado}`}
                            type="number"
                            step="0.01"
                            defaultValue={p.price_fiado ?? ""}
                            placeholder="—"
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              const v = raw ? Number(raw) : null;
                              if (v === null || (!Number.isNaN(v) && v >= 0))
                                updateProduct(p.id, { price_fiado: v });
                            }}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            Preço atacado / qtd mínima
                          </label>
                          <div className="mt-1 flex items-center gap-1">
                            <select
                              value={wholesaleDraftFor(p).mode}
                              onChange={(e) =>
                                setWholesaleDrafts((prev) => ({
                                  ...prev,
                                  [p.id]: { ...wholesaleDraftFor(p), mode: e.target.value as "valor" | "percentual" },
                                }))
                              }
                              className="rounded border border-slate-300 bg-white px-1 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                            >
                              <option value="valor">R$</option>
                              <option value="percentual">%</option>
                            </select>
                            <input
                              type="number"
                              step="0.01"
                              placeholder={wholesaleDraftFor(p).mode === "percentual" ? "ex: 10" : "R$"}
                              value={wholesaleDraftFor(p).price}
                              onChange={(e) =>
                                setWholesaleDrafts((prev) => ({
                                  ...prev,
                                  [p.id]: { ...wholesaleDraftFor(p), price: e.target.value },
                                }))
                              }
                              className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                            />
                            <input
                              type="number"
                              placeholder="qtd"
                              value={wholesaleDraftFor(p).minQty}
                              onChange={(e) =>
                                setWholesaleDrafts((prev) => ({
                                  ...prev,
                                  [p.id]: { ...wholesaleDraftFor(p), minQty: e.target.value },
                                }))
                              }
                              className="w-14 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                            />
                            <button
                              onClick={() => handleSaveWholesale(p)}
                              className="text-xs font-medium text-blue-900 hover:underline dark:text-blue-400"
                            >
                              Salvar
                            </button>
                          </div>
                          {wholesaleDraftFor(p).mode === "percentual" && wholesaleDraftFor(p).price.trim() && (
                            <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                              = {formatCurrency(
                                Math.round(p.price * (1 - Number(wholesaleDraftFor(p).price.replace(",", ".")) / 100) * 100) / 100,
                              )}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            Alertar quando estoque ≤
                          </label>
                          <input
                            key={`alert-${p.id}-${p.stock_alert_threshold}`}
                            type="number"
                            defaultValue={p.stock_alert_threshold}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isNaN(v) && v >= 0)
                                updateProduct(p.id, { stock_alert_threshold: v });
                            }}
                            className="mt-1 w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          />
                        </div>
                        <div>
                          <label className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                            <input
                              type="checkbox"
                              checked={offerUiOpenFor(p)}
                              onChange={(e) => handleToggleOfferUi(p, e.target.checked)}
                            />
                            Em oferta hoje
                          </label>
                          {offerUiOpenFor(p) && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Preço da oferta"
                                value={offerDraftFor(p)}
                                onChange={(e) =>
                                  setOfferDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                              />
                              <input
                                type="date"
                                title="Até quando vale a oferta (opcional — sem data, fica até você desmarcar)"
                                value={offerEndsAtDraftFor(p)}
                                onChange={(e) =>
                                  setOfferEndsAtDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                              />
                              <button
                                onClick={() => handleSaveOfferPrice(p)}
                                className="text-xs font-medium text-blue-900 hover:underline dark:text-blue-400"
                              >
                                Salvar
                              </button>
                              {p.on_offer && p.offer_ends_at && (
                                <span className="w-full text-xs text-slate-400">
                                  {new Date(p.offer_ends_at) > new Date()
                                    ? `Válida até ${new Date(p.offer_ends_at).toLocaleDateString("pt-BR")}`
                                    : "Prazo vencido — não aparece mais no site nem no balcão"}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            Histórico de preço
                          </label>
                          <div className="mt-1">
                            <PriceHistoryChart productId={p.id} />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            Vendas nos últimos 30 dias
                          </label>
                          {stats[p.id] ? (
                            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                              {stats[p.id].units_sold_recent} un. vendida{stats[p.id].units_sold_recent === 1 ? "" : "s"} ·{" "}
                              {formatCurrency(stats[p.id].revenue_recent)} em faturamento
                              {stats[p.id].profit_recent !== null && (
                                <> · {formatCurrency(stats[p.id].profit_recent!)} de lucro</>
                              )}
                              <br />
                              {stats[p.id].last_sold_at
                                ? `Última venda: ${new Date(stats[p.id].last_sold_at!).toLocaleDateString("pt-BR")}`
                                : "Nunca vendeu"}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-slate-400">Carregando…</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-4">
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                          Registrar perda / quebra
                        </label>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <select
                            value={lossDraftFor(p.id).type}
                            onChange={(e) =>
                              setLossDrafts((prev) => ({
                                ...prev,
                                [p.id]: { ...lossDraftFor(p.id), type: e.target.value as StockMovement["type"] },
                              }))
                            }
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          >
                            <option value="quebra">Quebra</option>
                            <option value="perda">Perda / venceu / sumiu</option>
                            <option value="outro">Outro</option>
                          </select>
                          <input
                            type="number"
                            step={p.sold_by_weight ? "0.001" : "1"}
                            placeholder="Quantidade"
                            value={lossDraftFor(p.id).quantity}
                            onChange={(e) =>
                              setLossDrafts((prev) => ({ ...prev, [p.id]: { ...lossDraftFor(p.id), quantity: e.target.value } }))
                            }
                            className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          />
                          <input
                            placeholder="Nota (opcional)"
                            value={lossDraftFor(p.id).note}
                            onChange={(e) =>
                              setLossDrafts((prev) => ({ ...prev, [p.id]: { ...lossDraftFor(p.id), note: e.target.value } }))
                            }
                            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          />
                          <button
                            onClick={() => handleRegisterLoss(p)}
                            disabled={savingLoss === p.id}
                            className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
                          >
                            {savingLoss === p.id ? "Registrando…" : "Registrar baixa"}
                          </button>
                        </div>
                        {movements[p.id] && movements[p.id].length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {movements[p.id].map((m) => (
                              <li key={m.id}>
                                {MOVEMENT_LABEL[m.type]}: {m.quantity}
                                {m.unit_cost ? ` (${formatCurrency(m.unit_cost)}/un.)` : ""}
                                {m.note ? ` — ${m.note}` : ""} · {new Date(m.created_at).toLocaleDateString("pt-BR")}
                                {m.created_by ? ` · ${m.created_by}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
