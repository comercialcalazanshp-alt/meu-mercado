"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  type Product,
  type Neighborhood,
  type Store,
  type PagSeguroSdk,
  effectivePrice,
  lineTotalFor,
  formatCurrency,
  readableTextColor,
  storeInitials,
  darkenHex,
  isStoreOpenNow,
  groupProductsByCategory,
  loadPagSeguroSdk,
} from "@/lib/storefront-pricing";

export type HubModule = {
  partnership_id: string;
  category: string;
  store_id: string;
  store_slug: string;
  store_name: string;
  brand_color: string;
  accent_color: string;
};

type ModuleCatalog = {
  products: Product[];
  neighborhoods: Neighborhood[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
};

type CartLine = {
  key: string;
  storeId: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
};

type ReceiptRow = {
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
  items: { name: string; quantity: number; line_total?: number; price: number }[];
  store_total: number;
  discount: number;
  delivery_fee: number;
  neighborhood_name: string | null;
  status: string;
  eta_min_minutes: number | null;
  eta_max_minutes: number | null;
};

function cartKey(storeId: string, productId: string) {
  return `${storeId}|${productId}`;
}

export default function HubStorefrontClient({ hubStore, modules }: { hubStore: Store; modules: HubModule[] }) {
  const allModules: HubModule[] = useMemo(
    () => [
      {
        partnership_id: "hub",
        category: hubStore.name,
        store_id: hubStore.id,
        store_slug: hubStore.slug,
        store_name: hubStore.name,
        brand_color: hubStore.brand_color,
        accent_color: hubStore.accent_color,
      },
      ...modules,
    ],
    [hubStore, modules],
  );

  const cartStorageKey = `hub-cart:${hubStore.id}`;
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(hubStore.id);
  const [catalogs, setCatalogs] = useState<Record<string, ModuleCatalog>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartLoaded, setCartLoaded] = useState(false);
  const [view, setView] = useState<"catalogo" | "checkout" | "confirmado">("catalogo");

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCpf, setCustomerCpf] = useState("");
  const [deliveryByStore, setDeliveryByStore] = useState<Record<string, { neighborhoodId: string; address: string }>>({});
  const [paymentMethod, setPaymentMethod] = useState<"combinar" | "pix" | "cartao">("combinar");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pixQrCodeText, setPixQrCodeText] = useState<string | null>(null);
  const [pixQrCodeImage, setPixQrCodeImage] = useState<string | null>(null);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixError, setPixError] = useState<string | null>(null);

  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardPaid, setCardPaid] = useState(false);

  const [confirmedHubOrderId, setConfirmedHubOrderId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptRow[] | null>(null);

  const brandStyle = {
    "--brand-bg": hubStore.brand_color,
    "--brand-text": readableTextColor(hubStore.brand_color),
    "--accent-bg": hubStore.accent_color,
    "--accent-text": readableTextColor(hubStore.accent_color),
    "--page-bg": darkenHex(hubStore.brand_color, 0.38),
  } as React.CSSProperties;

  const storeStatus = isStoreOpenNow(hubStore);

  // Carrinho do hub fica separado do carrinho de loja única (chave própria)
  // — visitar um hub e uma loja comum no mesmo navegador não deve misturar
  // os dois carrinhos.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cartStorageKey);
      if (raw) setCart(JSON.parse(raw));
    } catch {
      // localStorage indisponível ou dado corrompido — segue com carrinho vazio
    }
    setCartLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartStorageKey]);

  useEffect(() => {
    if (!cartLoaded) return;
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    } catch {
      // sem espaço/permissão de storage — carrinho continua funcionando em memória
    }
  }, [cart, cartLoaded, cartStorageKey]);

  useEffect(() => {
    if (paymentMethod === "cartao") loadPagSeguroSdk().catch(() => {});
  }, [paymentMethod]);

  async function loadCatalog(storeId: string) {
    setCatalogs((prev) => {
      if (prev[storeId]?.loaded || prev[storeId]?.loading) return prev;
      return { ...prev, [storeId]: { products: [], neighborhoods: [], loading: true, loaded: false, error: null } };
    });
    if (catalogs[storeId]?.loaded || catalogs[storeId]?.loading) return;

    const supabase = getSupabase();
    const [{ data: products, error: productsError }, { data: neighborhoods }] = await Promise.all([
      supabase
        .from("products")
        .select(
          "id, name, category, price, image_url, stock, promo_buy_qty, promo_pay_qty, price_wholesale, wholesale_min_qty, on_offer, offer_price, offer_ends_at, created_at, barcode",
        )
        .eq("store_id", storeId)
        .eq("active", true)
        .order("category", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("neighborhoods")
        .select("id, name, fee, eta_min_minutes, eta_max_minutes")
        .eq("store_id", storeId)
        .eq("active", true)
        .order("name", { ascending: true }),
    ]);

    setCatalogs((prev) => ({
      ...prev,
      [storeId]: {
        products: products ?? [],
        neighborhoods: neighborhoods ?? [],
        loading: false,
        loaded: true,
        error: productsError ? "Não deu pra carregar os produtos dessa loja. Tente de novo." : null,
      },
    }));
  }

  // O módulo do próprio hub já começa expandido (é o mais provável de o
  // cliente comprar) — sem isso, o catálogo dele só carregaria se o
  // cliente clicasse pra fechar e abrir de novo, já que toggleModule só
  // busca dados durante um clique real.
  useEffect(() => {
    loadCatalog(hubStore.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubStore.id]);

  function toggleModule(storeId: string) {
    if (expandedStoreId === storeId) {
      setExpandedStoreId(null);
      return;
    }
    setExpandedStoreId(storeId);
    loadCatalog(storeId);
  }

  function setQuantity(storeId: string, productId: string, quantity: number) {
    setCart((prev) => ({ ...prev, [cartKey(storeId, productId)]: Math.max(0, quantity) }));
  }

  const cartItems: CartLine[] = useMemo(() => {
    const lines: CartLine[] = [];
    for (const [key, quantity] of Object.entries(cart)) {
      if (quantity <= 0) continue;
      const [storeId, productId] = key.split("|");
      const product = catalogs[storeId]?.products.find((p) => p.id === productId);
      if (!product) continue;
      const price = effectivePrice(product);
      const lineTotal = lineTotalFor(price, quantity, product.promo_buy_qty, product.promo_pay_qty, product.price_wholesale, product.wholesale_min_qty);
      lines.push({ key, storeId, productId, name: product.name, price, quantity, lineTotal });
    }
    return lines;
  }, [cart, catalogs]);

  const cartByStore = useMemo(() => {
    const map = new Map<string, CartLine[]>();
    for (const line of cartItems) {
      if (!map.has(line.storeId)) map.set(line.storeId, []);
      map.get(line.storeId)!.push(line);
    }
    return map;
  }, [cartItems]);

  const storesInCart = useMemo(() => allModules.filter((m) => cartByStore.has(m.store_id)), [allModules, cartByStore]);

  const subtotal = cartItems.reduce((sum, l) => sum + l.lineTotal, 0);
  const cartCount = cartItems.reduce((sum, l) => sum + l.quantity, 0);

  const deliveryFeeTotal = storesInCart.reduce((sum, m) => {
    const choice = deliveryByStore[m.store_id];
    if (!choice || choice.neighborhoodId === "retirada" || !choice.neighborhoodId) return sum;
    const n = catalogs[m.store_id]?.neighborhoods.find((x) => x.id === choice.neighborhoodId);
    return sum + (n?.fee ?? 0);
  }, 0);

  const totalGeral = subtotal + deliveryFeeTotal;

  function openCheckout() {
    if (cartItems.length === 0) {
      setError("Seu carrinho está vazio.");
      return;
    }
    setError(null);
    setView("checkout");
  }

  async function handleCheckout(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    if (!storeStatus.open) {
      setError(storeStatus.message ?? "Loja fechada no momento.");
      return;
    }
    if (cartItems.length === 0) {
      setError("Seu carrinho está vazio.");
      return;
    }
    for (const m of storesInCart) {
      const choice = deliveryByStore[m.store_id];
      if (choice && choice.neighborhoodId !== "retirada" && choice.neighborhoodId && !choice.address?.trim()) {
        setError(`Preencha o endereço de entrega de "${m.store_name}".`);
        return;
      }
    }

    setSaving(true);
    const carts = storesInCart.map((m) => {
      const choice = deliveryByStore[m.store_id];
      const isDelivery = choice && choice.neighborhoodId !== "retirada" && choice.neighborhoodId;
      return {
        store_id: m.store_id,
        items: (cartByStore.get(m.store_id) ?? []).map((l) => ({ product_id: l.productId, quantity: l.quantity })),
        neighborhood_id: isDelivery ? choice.neighborhoodId : undefined,
        delivery_address: isDelivery ? choice.address.trim() : undefined,
      };
    });

    const { data, error: rpcError } = await getSupabase().rpc("checkout_hub", {
      p_hub_store_id: hubStore.id,
      p_customer_name: customerName.trim(),
      p_customer_phone: customerPhone.trim(),
      p_carts: carts,
    });

    if (rpcError) {
      setError(rpcError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    const hubOrderId = data?.[0]?.hub_order_id ?? null;
    setConfirmedHubOrderId(hubOrderId);
    setView("confirmado");
    setCart({});

    if (hubOrderId) {
      const { data: receiptData } = await getSupabase().rpc("get_hub_order_receipt", { p_hub_order_id: hubOrderId });
      setReceipt((receiptData as ReceiptRow[]) ?? null);
    }

    if (paymentMethod === "pix" && hubOrderId) {
      setPixLoading(true);
      setPixError(null);
      try {
        const res = await fetch("/api/pagbank/create-pix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hub_order_id: hubOrderId, customer_tax_id: customerCpf.trim() }),
        });
        const pixData = await res.json();
        if (!res.ok) {
          setPixError("Não deu pra gerar o Pix agora — combine o pagamento direto com a loja pelo WhatsApp.");
        } else {
          setPixQrCodeText(pixData.qr_code_text ?? null);
          setPixQrCodeImage(pixData.qr_code_image ?? null);
        }
      } catch {
        setPixError("Não deu pra gerar o Pix agora — combine o pagamento direto com a loja pelo WhatsApp.");
      } finally {
        setPixLoading(false);
      }
    }

    if (paymentMethod === "cartao" && hubOrderId) {
      setCardLoading(true);
      setCardError(null);
      try {
        await loadPagSeguroSdk();
        const keyRes = await fetch("/api/pagbank/public-key", { method: "POST" });
        const keyData = await keyRes.json();
        if (!keyRes.ok || !keyData.public_key) throw new Error("no-public-key");

        const [expMonth, expYear] = cardExpiry.split("/").map((s) => s.trim());
        const pagSeguro = (window as unknown as { PagSeguro: PagSeguroSdk }).PagSeguro;
        const card = pagSeguro.encryptCard({
          publicKey: keyData.public_key,
          holder: cardHolder,
          number: cardNumber.replace(/\s/g, ""),
          expMonth,
          expYear: expYear?.length === 2 ? `20${expYear}` : expYear,
          securityCode: cardCvv,
        });

        if (card.hasErrors || !card.encryptedCard) {
          setCardError("Confira os dados do cartão e tente de novo.");
        } else {
          const chargeRes = await fetch("/api/pagbank/charge-card", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hub_order_id: hubOrderId,
              encrypted_card: card.encryptedCard,
              holder_name: cardHolder,
              holder_cpf: customerCpf,
            }),
          });
          const chargeData = await chargeRes.json();
          if (!chargeRes.ok || !chargeData.paid) {
            setCardError(chargeData.reason || "Não deu pra aprovar o cartão agora — combine o pagamento direto com a loja pelo WhatsApp.");
          } else {
            setCardPaid(true);
          }
        }
      } catch {
        setCardError("Não deu pra processar o cartão agora — combine o pagamento direto com a loja pelo WhatsApp.");
      } finally {
        setCardLoading(false);
      }
    }
  }

  if (view === "confirmado") {
    const receiptTotal = receipt?.reduce((s, r) => s + r.store_total, 0) ?? totalGeral;
    return (
      <div style={brandStyle} className="flex flex-1 flex-col items-center bg-[var(--page-bg)] px-4 py-10">
        <div className="w-full max-w-md">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand-bg)] text-2xl font-bold text-[var(--brand-text)] shadow-lg">
            ✓
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">Pedido enviado!</h1>
          <p className="mt-1 text-sm text-white/70">
            {receipt && receipt.length > 1
              ? `Seu pedido foi dividido em ${receipt.length} lojas — cada uma vai preparar a parte dela.`
              : "Seu pedido foi enviado."}
          </p>

          <div className="mt-6 space-y-3">
            {(receipt ?? []).map((r) => (
              <div key={r.order_id} className="rounded-2xl border border-white/10 bg-white p-4 shadow-sm dark:bg-slate-900">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{r.store_name}</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                  {r.items.map((item, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{item.quantity}x {item.name}</span>
                      <span>{formatCurrency(item.line_total ?? item.price * item.quantity)}</span>
                    </li>
                  ))}
                </ul>
                {r.delivery_fee > 0 && (
                  <p className="mt-1 flex justify-between text-xs text-slate-500">
                    <span>Entrega{r.neighborhood_name ? ` (${r.neighborhood_name})` : ""}</span>
                    <span>{formatCurrency(r.delivery_fee)}</span>
                  </p>
                )}
                <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-50">
                  <span>Subtotal dessa loja</span>
                  <span>{formatCurrency(r.store_total)}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl bg-[var(--brand-text)]/10 p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-white/60">Total combinado</p>
            <p className="text-2xl font-bold text-white">{formatCurrency(receiptTotal)}</p>
          </div>

          {paymentMethod === "pix" && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white p-4 text-center dark:bg-slate-900">
              {pixLoading && <p className="text-sm text-slate-500">Gerando o Pix…</p>}
              {pixError && <p className="text-sm text-red-600">{pixError}</p>}
              {pixQrCodeImage && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pixQrCodeImage} alt="QR Code Pix" className="mx-auto h-48 w-48" />
                  <p className="mt-2 text-xs text-slate-500">Escaneie com o app do seu banco pra pagar.</p>
                </>
              )}
              {pixQrCodeText && (
                <textarea
                  readOnly
                  value={pixQrCodeText}
                  onFocus={(e) => e.target.select()}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 p-2 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-800"
                  rows={3}
                />
              )}
            </div>
          )}

          {paymentMethod === "cartao" && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white p-4 text-center dark:bg-slate-900">
              {cardLoading && <p className="text-sm text-slate-500">Processando o cartão…</p>}
              {cardError && <p className="text-sm text-red-600">{cardError}</p>}
              {cardPaid && <p className="text-sm font-semibold text-green-600">✓ Pagamento aprovado!</p>}
            </div>
          )}

          {confirmedHubOrderId && (
            <a
              href={`/loja/${hubStore.slug}/pedido-hub/${confirmedHubOrderId}`}
              className="mt-6 block w-full rounded-full border border-white/20 px-4 py-3 text-center font-semibold text-white"
            >
              Ver recibo completo
            </a>
          )}
          <a
            href={`/loja/${hubStore.slug}`}
            className="mt-3 block w-full rounded-full bg-[var(--accent-bg)] px-4 py-3 text-center font-semibold text-[var(--accent-text)] shadow-sm"
          >
            Voltar à loja
          </a>
        </div>
      </div>
    );
  }

  if (view === "checkout") {
    return (
      <div style={brandStyle} className="flex flex-1 flex-col items-center bg-[var(--page-bg)] px-4 py-10">
        <form onSubmit={handleCheckout} className="w-full max-w-md space-y-4">
          <button type="button" onClick={() => setView("catalogo")} className="text-sm font-medium text-white/70 underline">
            ← Voltar pro catálogo
          </button>
          <h1 className="text-xl font-bold text-white">Finalizar pedido</h1>

          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Seu nome</label>
            <input
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
            />
            <label className="mt-3 block text-xs font-medium text-slate-500 dark:text-slate-400">WhatsApp</label>
            <input
              required
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="(11) 91234-5678"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
            />
          </div>

          {storesInCart.map((m) => {
            const lines = cartByStore.get(m.store_id) ?? [];
            const storeSubtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
            const choice = deliveryByStore[m.store_id] ?? { neighborhoodId: "retirada", address: "" };
            const neighborhoods = catalogs[m.store_id]?.neighborhoods ?? [];
            return (
              <div key={m.store_id} className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{m.store_name}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {lines.map((l) => (
                    <li key={l.key} className="flex justify-between">
                      <span>{l.quantity}x {l.name}</span>
                      <span>{formatCurrency(l.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 flex justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
                  <span>Subtotal</span>
                  <span>{formatCurrency(storeSubtotal)}</span>
                </p>

                {neighborhoods.length > 0 ? (
                  <>
                    <label className="mt-3 block text-xs font-medium text-slate-500 dark:text-slate-400">Entrega de {m.store_name}</label>
                    <select
                      value={choice.neighborhoodId}
                      onChange={(e) =>
                        setDeliveryByStore((prev) => ({ ...prev, [m.store_id]: { neighborhoodId: e.target.value, address: prev[m.store_id]?.address ?? "" } }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                    >
                      <option value="retirada">Retirar no local</option>
                      {neighborhoods.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name} — {formatCurrency(n.fee)}
                        </option>
                      ))}
                    </select>
                    {choice.neighborhoodId !== "retirada" && (
                      <input
                        required
                        value={choice.address}
                        onChange={(e) => setDeliveryByStore((prev) => ({ ...prev, [m.store_id]: { ...choice, address: e.target.value } }))}
                        placeholder="Endereço completo de entrega"
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                      />
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">Combine a entrega dessa loja direto com ela.</p>
                )}
              </div>
            );
          })}

          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Forma de pagamento</p>
            <div className="mt-2 space-y-1.5">
              {(["combinar", "pix", "cartao"] as const).map((pm) => (
                <label key={pm} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="radio" name="paymentMethod" checked={paymentMethod === pm} onChange={() => setPaymentMethod(pm)} />
                  {pm === "combinar" ? "Combinar direto com a loja" : pm === "pix" ? "Pix" : "Cartão"}
                </label>
              ))}
            </div>
            {(paymentMethod === "pix" || paymentMethod === "cartao") && (
              <input
                required
                value={customerCpf}
                onChange={(e) => setCustomerCpf(e.target.value)}
                placeholder="Seu CPF"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
              />
            )}
            {paymentMethod === "cartao" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input required value={cardHolder} onChange={(e) => setCardHolder(e.target.value)} placeholder="Nome no cartão" className="col-span-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50" />
                <input required value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="Número do cartão" className="col-span-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50" />
                <input required value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="MM/AA" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50" />
                <input required value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} placeholder="CVV" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50" />
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-[var(--brand-text)]/10 p-4">
            <p className="flex justify-between text-sm text-white/80">
              <span>Produtos</span>
              <span>{formatCurrency(subtotal)}</span>
            </p>
            {deliveryFeeTotal > 0 && (
              <p className="flex justify-between text-sm text-white/80">
                <span>Entrega</span>
                <span>{formatCurrency(deliveryFeeTotal)}</span>
              </p>
            )}
            <p className="mt-1 flex justify-between border-t border-white/20 pt-1 text-lg font-bold text-white">
              <span>Total</span>
              <span>{formatCurrency(totalGeral)}</span>
            </p>
          </div>

          {error && <p className="text-sm text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-full bg-[var(--accent-bg)] px-4 py-3 font-semibold text-[var(--accent-text)] shadow-sm disabled:opacity-60"
          >
            {saving ? "Enviando…" : `Confirmar pedido — ${formatCurrency(totalGeral)}`}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={brandStyle} className="flex flex-1 flex-col bg-[var(--page-bg)] pb-28">
      <header className="bg-[var(--brand-bg)] px-6 pb-8 pt-10 text-center text-[var(--brand-text)]">
        <div className="mx-auto flex max-w-3xl flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--brand-text)]/15 text-2xl font-bold ring-1 ring-inset ring-[var(--brand-text)]/25">
            {storeInitials(hubStore.name)}
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-4xl">{hubStore.name}</h1>
          <p className="mt-2 text-sm opacity-80">Escolha uma loja abaixo pra ver os produtos</p>
        </div>
      </header>

      {!storeStatus.open && storeStatus.message && (
        <div className="bg-amber-100 px-4 py-2.5 text-center text-sm font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          🕒 {storeStatus.message}
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 pt-6 sm:px-6">
        {allModules.map((m) => {
          const isExpanded = expandedStoreId === m.store_id;
          const catalog = catalogs[m.store_id];
          const moduleStyle = {
            "--mod-bg": m.brand_color,
            "--mod-text": readableTextColor(m.brand_color),
            "--mod-accent": m.accent_color,
            "--mod-accent-text": readableTextColor(m.accent_color),
          } as React.CSSProperties;
          const storeCartCount = (cartByStore.get(m.store_id) ?? []).reduce((s, l) => s + l.quantity, 0);

          return (
            <div key={m.store_id} style={moduleStyle} className="overflow-hidden rounded-2xl shadow-sm">
              <button
                type="button"
                onClick={() => toggleModule(m.store_id)}
                className="flex w-full items-center justify-between gap-3 bg-[var(--mod-bg)] px-5 py-4 text-left text-[var(--mod-text)]"
              >
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide opacity-70">{m.category}</p>
                  <p className="text-lg font-bold">{m.store_name}</p>
                </div>
                <div className="flex items-center gap-2">
                  {storeCartCount > 0 && (
                    <span className="rounded-full bg-[var(--mod-text)]/20 px-2 py-0.5 text-xs font-semibold">{storeCartCount} no carrinho</span>
                  )}
                  <span className="text-xl">{isExpanded ? "−" : "+"}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="bg-white p-4 dark:bg-slate-900">
                  {catalog?.loading && <p className="text-sm text-slate-500">Carregando produtos…</p>}
                  {catalog?.error && <p className="text-sm text-red-600">{catalog.error}</p>}
                  {catalog?.loaded && catalog.products.length === 0 && (
                    <p className="text-sm text-slate-500">Essa loja ainda não cadastrou produtos.</p>
                  )}
                  {catalog?.loaded &&
                    groupProductsByCategory(catalog.products).map(([category, products]) => (
                      <div key={category} className="mb-4 last:mb-0">
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{category}</h3>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {products.map((product) => {
                            const key = cartKey(m.store_id, product.id);
                            const quantity = cart[key] ?? 0;
                            const price = effectivePrice(product);
                            return (
                              <div key={product.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{product.name}</p>
                                  <p className="text-sm text-[var(--mod-bg)]">{formatCurrency(price)}</p>
                                </div>
                                {quantity === 0 ? (
                                  <button
                                    onClick={() => setQuantity(m.store_id, product.id, 1)}
                                    disabled={product.stock <= 0}
                                    className="shrink-0 rounded-full bg-[var(--mod-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--mod-accent-text)] disabled:opacity-40"
                                  >
                                    {product.stock <= 0 ? "Sem estoque" : "Adicionar"}
                                  </button>
                                ) : (
                                  <div className="flex shrink-0 items-center gap-2">
                                    <button onClick={() => setQuantity(m.store_id, product.id, quantity - 1)} className="h-7 w-7 rounded-full border border-slate-300 text-sm dark:border-slate-700">
                                      −
                                    </button>
                                    <span className="w-5 text-center text-sm font-semibold">{quantity}</span>
                                    <button
                                      onClick={() => setQuantity(m.store_id, product.id, quantity + 1)}
                                      disabled={quantity >= product.stock}
                                      className="h-7 w-7 rounded-full border border-slate-300 text-sm disabled:opacity-40 dark:border-slate-700"
                                    >
                                      +
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4">
          <button
            onClick={openCheckout}
            className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-[var(--accent-bg)] px-5 py-3.5 font-semibold text-[var(--accent-text)] shadow-xl"
          >
            <span>🛒 {cartCount} {cartCount === 1 ? "item" : "itens"} · {storesInCart.length} {storesInCart.length === 1 ? "loja" : "lojas"}</span>
            <span>{formatCurrency(subtotal)} →</span>
          </button>
        </div>
      )}
    </div>
  );
}
