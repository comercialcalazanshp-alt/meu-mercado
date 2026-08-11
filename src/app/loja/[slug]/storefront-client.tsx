"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

type Product = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  image_url: string | null;
  stock: number;
};

type Store = {
  id: string;
  slug: string;
  name: string;
  whatsapp: string | null;
  cashback_percent: number;
  business_hours_enabled: boolean;
  opens_at: string | null;
  closes_at: string | null;
  open_days: number[];
  manually_closed: boolean;
};

function isStoreOpenNow(store: Store): { open: boolean; message: string | null } {
  if (!store.business_hours_enabled) return { open: true, message: null };
  if (store.manually_closed) return { open: false, message: "Loja fechada no momento." };
  if (!store.opens_at || !store.closes_at) return { open: true, message: null };

  const now = new Date();
  const day = now.getDay();
  if (!store.open_days.includes(day)) {
    return { open: false, message: `Loja fechada hoje. Abre às ${store.opens_at.slice(0, 5)}.` };
  }

  const [openH, openM] = store.opens_at.split(":").map(Number);
  const [closeH, closeM] = store.closes_at.split(":").map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  if (nowMinutes < openMinutes) {
    return { open: false, message: `Loja fechada. Abre às ${store.opens_at.slice(0, 5)}.` };
  }
  if (nowMinutes >= closeMinutes) {
    return { open: false, message: `Loja fechada. Volta a abrir às ${store.opens_at.slice(0, 5)}.` };
  }
  return { open: true, message: null };
}

type Banner = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
};

type Neighborhood = {
  id: string;
  name: string;
  fee: number;
};

type KitComponent = {
  quantity: number;
  products: { name: string; stock: number } | null;
};

export type Kit = {
  id: string;
  name: string;
  image_url: string | null;
  price: number;
  kit_items: KitComponent[];
};

export type Review = {
  id: string;
  product_id: string;
  customer_name: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

type CartLine = {
  key: string;
  kind: "product" | "kit";
  id: string;
  name: string;
  price: number;
  quantity: number;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function kitMaxQuantity(kit: Kit) {
  if (kit.kit_items.length === 0) return 0;
  return Math.min(
    ...kit.kit_items.map((item) => Math.floor((item.products?.stock ?? 0) / item.quantity)),
  );
}

export default function StorefrontClient({
  store,
  products,
  banners,
  kits,
  reviews: initialReviews,
  neighborhoods,
}: {
  store: Store;
  products: Product[];
  banners: Banner[];
  kits: Kit[];
  reviews: Review[];
  neighborhoods: Neighborhood[];
}) {
  const searchParams = useSearchParams();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [reviews, setReviews] = useState<Review[]>(initialReviews);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerRating, setReviewerRating] = useState(5);
  const [reviewerComment, setReviewerComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"catalogo" | "checkout" | "confirmado">("catalogo");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);
  const [confirmedDiscount, setConfirmedDiscount] = useState(0);
  const [couponCode, setCouponCode] = useState("");
  const [couponPreview, setCouponPreview] = useState<{
    valid: boolean;
    message: string;
    discount: number;
  } | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [useCashback, setUseCashback] = useState(false);
  const [birthday, setBirthday] = useState("");
  const [confirmedCashbackEarned, setConfirmedCashbackEarned] = useState(0);
  const [confirmedCashbackUsed, setConfirmedCashbackUsed] = useState(0);
  const [confirmedReferralCode, setConfirmedReferralCode] = useState<string | null>(null);
  const [confirmedReferralBonus, setConfirmedReferralBonus] = useState(0);
  const [neighborhoodId, setNeighborhoodId] = useState<string>("retirada");
  const [confirmedDeliveryFee, setConfirmedDeliveryFee] = useState(0);

  const cartItems = useMemo(() => {
    const lines: CartLine[] = [];
    for (const [key, quantity] of Object.entries(cart)) {
      if (quantity <= 0) continue;
      const [kind, id] = key.split(":") as ["product" | "kit", string];
      if (kind === "product") {
        const product = products.find((p) => p.id === id);
        if (product) lines.push({ key, kind, id, name: product.name, price: product.price, quantity });
      } else if (kind === "kit") {
        const kit = kits.find((k) => k.id === id);
        if (kit) lines.push({ key, kind, id, name: `Kit: ${kit.name}`, price: kit.price, quantity });
      }
    }
    return lines;
  }, [cart, products, kits]);

  const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const storeStatus = useMemo(() => isStoreOpenNow(store), [store]);
  const deliveryFee =
    neighborhoodId === "retirada"
      ? 0
      : (neighborhoods.find((n) => n.id === neighborhoodId)?.fee ?? 0);
  const totalWithDelivery =
    total - (couponPreview?.valid ? couponPreview.discount : 0) + deliveryFee;

  const categories = useMemo(() => {
    const groups = new Map<string, Product[]>();
    for (const product of products) {
      const key = product.category || "Outros";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(product);
    }
    return Array.from(groups.entries());
  }, [products]);

  function setQuantity(key: string, quantity: number) {
    setCart((prev) => ({ ...prev, [key]: Math.max(0, quantity) }));
  }

  const ratingsByProduct = useMemo(() => {
    const map = new Map<string, { avg: number; count: number }>();
    for (const review of reviews) {
      const cur = map.get(review.product_id) ?? { avg: 0, count: 0 };
      cur.avg = (cur.avg * cur.count + review.rating) / (cur.count + 1);
      cur.count += 1;
      map.set(review.product_id, cur);
    }
    return map;
  }, [reviews]);

  useEffect(() => {
    const listaId = searchParams.get("lista");
    if (!listaId) return;

    (async () => {
      const { data } = await getSupabase()
        .from("shared_lists")
        .select("items")
        .eq("id", listaId)
        .eq("store_id", store.id)
        .maybeSingle();

      if (data?.items) {
        const restored: Record<string, number> = {};
        for (const item of data.items as { kind: string; id: string; quantity: number }[]) {
          restored[`${item.kind}:${item.id}`] = item.quantity;
        }
        setCart(restored);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, store.id]);

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) setReferralCode(ref.toUpperCase());
  }, [searchParams]);

  // Registra a visita (uma "sessão" por aba, guardada no sessionStorage —
  // dura enquanto a aba fica aberta) e mede quanto tempo/quantas telas o
  // cliente viu antes de comprar ou ir embora. Não usa cookie nem nada que
  // sirva pra identificar a pessoa entre visitas diferentes.
  const visitStorageKey = `mm_visit_${store.id}`;
  const isFirstViewChange = useRef(true);

  useEffect(() => {
    const supabase = getSupabase();
    let sessionId = sessionStorage.getItem(visitStorageKey);
    const isNewSession = !sessionId;

    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem(visitStorageKey, sessionId);
    }
    supabase
      .rpc("track_site_visit", {
        p_store_id: store.id,
        p_session_id: sessionId,
        p_count_view: isNewSession,
      })
      .then(({ error }) => {
        if (error) console.error("Erro ao registrar visita:", error.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isFirstViewChange.current) {
      isFirstViewChange.current = false;
      return;
    }
    const sessionId = sessionStorage.getItem(visitStorageKey);
    if (!sessionId) return;

    getSupabase()
      .rpc("track_site_visit", {
        p_store_id: store.id,
        p_session_id: sessionId,
        p_count_view: true,
      })
      .then(({ error }) => {
        if (error) console.error("Erro ao registrar visualização:", error.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  async function handleSubmitReview(productId: string) {
    if (!reviewerName.trim() || submittingReview) return;
    setSubmittingReview(true);
    const { data, error: reviewError } = await getSupabase()
      .from("reviews")
      .insert({
        store_id: store.id,
        product_id: productId,
        customer_name: reviewerName.trim(),
        rating: reviewerRating,
        comment: reviewerComment.trim() || null,
      })
      .select("id, product_id, customer_name, rating, comment, created_at")
      .single();
    setSubmittingReview(false);

    if (!reviewError && data) {
      setReviews((prev) => [data, ...prev]);
      setReviewerName("");
      setReviewerComment("");
      setReviewerRating(5);
    }
  }

  async function handleShareList() {
    if (cartItems.length === 0 || sharing) return;
    setSharing(true);
    const { data } = await getSupabase()
      .from("shared_lists")
      .insert({
        store_id: store.id,
        items: cartItems.map((item) => ({ kind: item.kind, id: item.id, quantity: item.quantity })),
      })
      .select("id")
      .single();
    setSharing(false);
    if (data) {
      setShareUrl(`${window.location.origin}/loja/${store.slug}?lista=${data.id}`);
      setCopied(false);
    }
  }

  function handleCopyShareUrl() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
  }

  async function handleApplyCoupon() {
    if (!couponCode.trim() || checkingCoupon) return;
    setCheckingCoupon(true);
    const { data } = await getSupabase().rpc("preview_coupon", {
      p_store_id: store.id,
      p_code: couponCode.trim(),
      p_subtotal: total,
    });
    setCheckingCoupon(false);
    setCouponPreview(data?.[0] ?? { valid: false, message: "Cupom inválido", discount: 0 });
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

    setSaving(true);
    // O preço e a baixa de estoque são recalculados no banco (função
    // "checkout") — o navegador só manda produto e quantidade, nunca preço,
    // pra ninguém conseguir adulterar o valor do pedido pelo devtools.
    const { data, error: rpcError } = await getSupabase().rpc("checkout", {
      p_store_id: store.id,
      p_customer_name: customerName.trim(),
      p_customer_phone: customerPhone.trim(),
      p_items: cartItems.map((item) =>
        item.kind === "product"
          ? { product_id: item.id, quantity: item.quantity }
          : { kit_id: item.id, quantity: item.quantity },
      ),
      p_coupon_code: couponCode.trim() || undefined,
      p_referral_code: referralCode.trim() || undefined,
      p_use_cashback: useCashback,
      p_birthday: birthday || undefined,
      p_neighborhood_id: neighborhoodId === "retirada" ? undefined : neighborhoodId,
    });

    if (rpcError) {
      setError(rpcError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setConfirmedTotal(data?.[0]?.total ?? total);
    setConfirmedDiscount(data?.[0]?.discount ?? 0);
    setConfirmedCashbackEarned(data?.[0]?.cashback_earned ?? 0);
    setConfirmedCashbackUsed(data?.[0]?.cashback_used ?? 0);
    setConfirmedReferralCode(data?.[0]?.referral_code ?? null);
    setConfirmedReferralBonus(data?.[0]?.referral_bonus_earned ?? 0);
    setConfirmedDeliveryFee(data?.[0]?.delivery_fee ?? 0);
    setView("confirmado");

    const sessionId = sessionStorage.getItem(visitStorageKey);
    if (sessionId) {
      getSupabase()
        .rpc("track_site_visit", {
          p_store_id: store.id,
          p_session_id: sessionId,
          p_mark_converted: true,
          p_count_view: false,
        })
        .then(({ error }) => {
          if (error) console.error("Erro ao registrar conversão:", error.message);
        });
    }
  }

  if (view === "confirmado") {
    const finalTotal = confirmedTotal ?? total;
    const whatsappMessage = encodeURIComponent(
      `Olá! Acabei de fazer um pedido na ${store.name} no valor de ${formatCurrency(finalTotal)}.`,
    );
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-900 text-2xl font-bold text-amber-300 dark:bg-blue-800">
          ✓
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Pedido enviado!</h1>
        <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
          A loja {store.name} vai receber seu pedido. Total: {formatCurrency(finalTotal)}
          {confirmedDiscount > 0 && ` (com ${formatCurrency(confirmedDiscount)} de desconto)`}.
        </p>
        {confirmedDeliveryFee > 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Inclui {formatCurrency(confirmedDeliveryFee)} de frete.
          </p>
        )}
        {confirmedCashbackUsed > 0 && (
          <p className="text-sm text-green-700 dark:text-green-400">
            Você usou {formatCurrency(confirmedCashbackUsed)} de cashback nesse pedido.
          </p>
        )}
        {confirmedCashbackEarned > 0 && (
          <p className="text-sm text-green-700 dark:text-green-400">
            Você ganhou {formatCurrency(confirmedCashbackEarned)} de cashback pra próxima compra!
          </p>
        )}
        {confirmedReferralBonus > 0 && (
          <p className="text-sm text-green-700 dark:text-green-400">
            + {formatCurrency(confirmedReferralBonus)} de bônus por usar um código de indicação!
          </p>
        )}
        {confirmedReferralCode && (
          <div className="mt-1 max-w-xs rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-slate-600 dark:text-slate-400">Indique a loja pra um amigo com seu código:</p>
            <p className="mt-1 text-lg font-bold tracking-wide text-blue-900 dark:text-blue-400">
              {confirmedReferralCode}
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `${window.location.origin}/loja/${store.slug}?ref=${confirmedReferralCode}`,
                );
              }}
              className="mt-1 text-xs font-medium text-blue-900 underline dark:text-blue-400"
            >
              Copiar link de indicação
            </button>
          </div>
        )}
        {store.whatsapp && (
          <a
            href={`https://wa.me/55${store.whatsapp.replace(/\D/g, "")}?text=${whatsappMessage}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Avisar a loja no WhatsApp
          </a>
        )}
      </div>
    );
  }

  if (view === "checkout") {
    return (
      <div className="flex flex-1 flex-col items-center bg-slate-50 px-6 py-10 dark:bg-slate-950">
        <div className="w-full max-w-sm">
          <button
            onClick={() => setView("catalogo")}
            className="mb-4 text-sm text-slate-500 hover:underline dark:text-slate-400"
          >
            ← Voltar ao catálogo
          </button>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">Finalizar pedido</h1>

          <ul className="mt-4 space-y-1 text-sm">
            {cartItems.map((item) => (
              <li key={item.key} className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>
                  {item.quantity}x {item.name}
                </span>
                <span>{formatCurrency(item.price * item.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3">
            {shareUrl ? (
              <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">
                <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-400">
                  {shareUrl}
                </span>
                <button
                  type="button"
                  onClick={handleCopyShareUrl}
                  className="shrink-0 font-medium text-blue-900 dark:text-blue-400"
                >
                  {copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleShareList}
                disabled={sharing}
                className="text-sm font-medium text-blue-900 underline disabled:opacity-50 dark:text-blue-400"
              >
                {sharing ? "Gerando link…" : "Compartilhar esta lista"}
              </button>
            )}
          </div>

          <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Cupom de desconto
            </label>
            <div className="mt-1 flex gap-2">
              <input
                value={couponCode}
                onChange={(e) => {
                  setCouponCode(e.target.value);
                  setCouponPreview(null);
                }}
                placeholder="Código do cupom"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
              <button
                type="button"
                onClick={handleApplyCoupon}
                disabled={!couponCode.trim() || checkingCoupon}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
              >
                {checkingCoupon ? "Checando…" : "Aplicar"}
              </button>
            </div>
            {couponPreview && (
              <p
                className={`mt-1 text-sm ${couponPreview.valid ? "text-green-600" : "text-red-600"}`}
              >
                {couponPreview.valid
                  ? `${couponPreview.message} −${formatCurrency(couponPreview.discount)}`
                  : couponPreview.message}
              </p>
            )}
          </div>

          {neighborhoods.length > 0 && (
            <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Entrega
              </label>
              <select
                value={neighborhoodId}
                onChange={(e) => setNeighborhoodId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                <option value="retirada">Retirar na loja — grátis</option>
                {neighborhoods.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} — {n.fee > 0 ? formatCurrency(n.fee) : "grátis"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm dark:border-slate-800">
            <p className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Subtotal</span>
              <span>{formatCurrency(total)}</span>
            </p>
            {couponPreview?.valid && (
              <p className="flex justify-between text-green-600">
                <span>Desconto</span>
                <span>−{formatCurrency(couponPreview.discount)}</span>
              </p>
            )}
            {deliveryFee > 0 && (
              <p className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Entrega</span>
                <span>{formatCurrency(deliveryFee)}</span>
              </p>
            )}
            <p className="flex justify-between font-semibold text-slate-900 dark:text-slate-50">
              <span>Total</span>
              <span>{formatCurrency(totalWithDelivery)}</span>
            </p>
          </div>

          <form onSubmit={handleCheckout} className="mt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Seu nome
              </label>
              <input
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Seu WhatsApp
              </label>
              <input
                required
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="(11) 91234-5678"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>

            <details className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                Cashback e indicação (opcional)
              </summary>
              <div className="mt-2 space-y-2">
                {store.cashback_percent > 0 && (
                  <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={useCashback}
                      onChange={(e) => setUseCashback(e.target.checked)}
                    />
                    Usar meu saldo de cashback nesse pedido (se eu tiver)
                  </label>
                )}
                <div>
                  <label className="block text-slate-600 dark:text-slate-400">
                    Código de quem te indicou
                  </label>
                  <input
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                    placeholder="Ex: ABC123"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400">
                    Sua data de aniversário
                  </label>
                  <input
                    type="date"
                    value={birthday}
                    onChange={(e) => setBirthday(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  />
                </div>
              </div>
            </details>

            {!storeStatus.open && storeStatus.message && (
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                🕒 {storeStatus.message}
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={saving || !storeStatus.open}
              className="w-full rounded-lg bg-blue-900 px-4 py-2.5 font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
            >
              {saving ? "Enviando…" : "Enviar pedido"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-slate-50 pb-24 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-900 text-lg font-bold text-amber-300 dark:bg-blue-800">
          {store.name.slice(0, 2).toUpperCase()}
        </div>
        <h1 className="mt-3 text-xl font-bold text-slate-900 dark:text-slate-50">{store.name}</h1>
      </header>

      {!storeStatus.open && storeStatus.message && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          🕒 {storeStatus.message} Você pode ver o catálogo, mas o pedido só é enviado quando a loja
          reabrir.
        </div>
      )}

      {banners.length > 0 && (
        <div className="mx-auto w-full max-w-2xl px-4 pt-4">
          <div className="flex snap-x gap-3 overflow-x-auto pb-1">
            {banners.map((banner) => {
              const content = (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={banner.image_url}
                  alt={banner.title}
                  className="h-32 w-full shrink-0 snap-start rounded-xl object-cover sm:w-80"
                />
              );
              return banner.link_url ? (
                <a
                  key={banner.id}
                  href={banner.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                >
                  {content}
                </a>
              ) : (
                <div key={banner.id} className="shrink-0">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        {products.length === 0 && kits.length === 0 && (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Essa loja ainda não cadastrou produtos.
          </p>
        )}

        {kits.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Kits e combos
            </h2>
            <div className="space-y-2">
              {kits.map((kit) => {
                const key = `kit:${kit.id}`;
                const quantity = cart[key] ?? 0;
                const maxQty = kitMaxQuantity(kit);
                return (
                  <div
                    key={kit.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                  >
                    {kit.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={kit.image_url}
                        alt={kit.name}
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                        {kit.name}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {formatCurrency(kit.price)}
                      </p>
                      <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                        {kit.kit_items
                          .map((item) => `${item.quantity}x ${item.products?.name ?? ""}`)
                          .join(", ")}
                      </p>
                      {maxQty <= 0 && <p className="text-xs text-red-500">Sem estoque</p>}
                    </div>
                    {quantity === 0 ? (
                      <button
                        onClick={() => setQuantity(key, 1)}
                        disabled={maxQty <= 0}
                        className="shrink-0 rounded-lg bg-blue-900 px-3 py-1.5 text-sm font-semibold text-amber-300 disabled:opacity-40 dark:bg-blue-800"
                      >
                        Adicionar
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => setQuantity(key, quantity - 1)}
                          className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                          aria-label="Diminuir quantidade"
                        >
                          −
                        </button>
                        <span className="w-4 text-center text-sm text-slate-900 dark:text-slate-50">
                          {quantity}
                        </span>
                        <button
                          onClick={() => setQuantity(key, Math.min(quantity + 1, maxQty))}
                          disabled={quantity >= maxQty}
                          className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 disabled:opacity-40 dark:bg-slate-700 dark:text-slate-200"
                          aria-label="Aumentar quantidade"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {categories.map(([category, items]) => (
          <section key={category} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {category}
            </h2>
            <div className="space-y-2">
              {items.map((product) => {
                const key = `product:${product.id}`;
                const quantity = cart[key] ?? 0;
                const rating = ratingsByProduct.get(product.id);
                const productReviews = reviews.filter((r) => r.product_id === product.id);
                const isExpanded = expandedProductId === product.id;
                return (
                  <div
                    key={product.id}
                    className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-center gap-3 p-3">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-14 w-14 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                          {product.name}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          {formatCurrency(product.price)}
                        </p>
                        {product.stock <= 0 && (
                          <p className="text-xs text-red-500">Sem estoque</p>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedProductId(isExpanded ? null : product.id)}
                          className="text-xs text-blue-900 underline dark:text-blue-400"
                        >
                          {rating
                            ? `${"★".repeat(Math.round(rating.avg))}${"☆".repeat(5 - Math.round(rating.avg))} (${rating.count})`
                            : "Avaliar produto"}
                        </button>
                      </div>
                      {quantity === 0 ? (
                        <button
                          onClick={() => setQuantity(key, 1)}
                          disabled={product.stock <= 0}
                          className="shrink-0 rounded-lg bg-blue-900 px-3 py-1.5 text-sm font-semibold text-amber-300 disabled:opacity-40 dark:bg-blue-800"
                        >
                          Adicionar
                        </button>
                      ) : (
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            onClick={() => setQuantity(key, quantity - 1)}
                            className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                            aria-label="Diminuir quantidade"
                          >
                            −
                          </button>
                          <span className="w-4 text-center text-sm text-slate-900 dark:text-slate-50">
                            {quantity}
                          </span>
                          <button
                            onClick={() => setQuantity(key, Math.min(quantity + 1, product.stock))}
                            disabled={quantity >= product.stock}
                            className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 disabled:opacity-40 dark:bg-slate-700 dark:text-slate-200"
                            aria-label="Aumentar quantidade"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-100 p-3 dark:border-slate-800">
                        <ul className="space-y-2">
                          {productReviews.length === 0 && (
                            <li className="text-sm text-slate-400 dark:text-slate-500">
                              Nenhuma avaliação ainda.
                            </li>
                          )}
                          {productReviews.map((r) => (
                            <li key={r.id} className="text-sm">
                              <p className="font-medium text-amber-500">
                                {"★".repeat(r.rating)}
                                {"☆".repeat(5 - r.rating)}{" "}
                                <span className="text-slate-700 dark:text-slate-300">{r.customer_name}</span>
                              </p>
                              {r.comment && (
                                <p className="text-slate-500 dark:text-slate-400">{r.comment}</p>
                              )}
                            </li>
                          ))}
                        </ul>

                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                          <input
                            value={reviewerName}
                            onChange={(e) => setReviewerName(e.target.value)}
                            placeholder="Seu nome"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          />
                          <select
                            value={reviewerRating}
                            onChange={(e) => setReviewerRating(Number(e.target.value))}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          >
                            {[5, 4, 3, 2, 1].map((n) => (
                              <option key={n} value={n}>
                                {"★".repeat(n)} ({n})
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={reviewerComment}
                            onChange={(e) => setReviewerComment(e.target.value)}
                            placeholder="Comentário (opcional)"
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                          />
                          <button
                            type="button"
                            onClick={() => handleSubmitReview(product.id)}
                            disabled={!reviewerName.trim() || submittingReview}
                            className="w-full rounded-lg bg-blue-900 px-3 py-2 text-sm font-semibold text-amber-300 disabled:opacity-50 dark:bg-blue-800"
                          >
                            {submittingReview ? "Enviando…" : "Enviar avaliação"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <footer className="mx-auto w-full max-w-2xl px-4 pb-6 text-center text-xs text-slate-400 dark:text-slate-600">
        <a href="/privacidade" className="underline">
          Aviso de privacidade
        </a>
        {" · "}
        <a href="/termos" className="underline">
          Termo de uso
        </a>
      </footer>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <button
            onClick={() => setView("checkout")}
            className="mx-auto flex w-full max-w-2xl items-center justify-between rounded-lg bg-blue-900 px-4 py-3 font-semibold text-amber-300 dark:bg-blue-800"
          >
            <span>{cartCount} {cartCount === 1 ? "item" : "itens"}</span>
            <span>{formatCurrency(total)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
