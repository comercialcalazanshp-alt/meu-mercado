"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getCustomerSupabase } from "@/lib/supabase-customer";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PagSeguroSdk = {
  encryptCard: (params: {
    publicKey: string;
    holder: string;
    number: string;
    expMonth: string;
    expYear: string;
    securityCode: string;
  }) => { encryptedCard: string | null; hasErrors: boolean; errors?: unknown[] };
};

type Product = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  image_url: string | null;
  stock: number;
  promo_buy_qty: number | null;
  promo_pay_qty: number | null;
  price_wholesale: number | null;
  wholesale_min_qty: number | null;
  on_offer: boolean;
  offer_price: number | null;
  created_at: string;
};

function isNewProduct(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < 7 * 86400000;
}

function effectivePrice(product: Product) {
  return product.on_offer && product.offer_price !== null ? product.offer_price : product.price;
}

function lineTotalFor(
  price: number,
  quantity: number,
  buyQty: number | null,
  payQty: number | null,
  wholesalePrice: number | null,
  wholesaleMinQty: number | null,
) {
  if (wholesalePrice !== null && wholesaleMinQty !== null && quantity >= wholesaleMinQty) {
    return wholesalePrice * quantity;
  }
  if (!buyQty || !payQty || quantity < buyQty) return price * quantity;
  const fullGroups = Math.floor(quantity / buyQty);
  const remainder = quantity % buyQty;
  return (fullGroups * payQty + remainder) * price;
}

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
  scratch_enabled: boolean;
  brand_color: string;
  accent_color: string;
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

type StoreReviewSummary = {
  id: string;
  rating: number;
};

type KitComponent = {
  quantity: number;
  product_id: string;
  products: { name: string; price: number; stock: number } | null;
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

export type Recipe = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  image_url: string | null;
  ingredients: { id: string; qty: number }[];
};

type CartLine = {
  key: string;
  kind: "product" | "kit";
  id: string;
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function readableTextColor(hex: string) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#fbbf24";
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.45 ? "#1e293b" : "#fbbf24";
}

let pagSeguroSdkPromise: Promise<void> | null = null;
function loadPagSeguroSdk(): Promise<void> {
  if (typeof window !== "undefined" && (window as unknown as { PagSeguro?: unknown }).PagSeguro) {
    return Promise.resolve();
  }
  if (!pagSeguroSdkPromise) {
    pagSeguroSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Falha ao carregar o pagamento com cartão"));
      document.body.appendChild(script);
    });
  }
  return pagSeguroSdkPromise;
}

function kitMaxQuantity(kit: Kit) {
  if (kit.kit_items.length === 0) return 0;
  return Math.min(
    ...kit.kit_items.map((item) => Math.floor((item.products?.stock ?? 0) / item.quantity)),
  );
}

function kitSavings(kit: Kit) {
  const separateTotal = kit.kit_items.reduce((sum, item) => sum + item.quantity * (item.products?.price ?? 0), 0);
  return separateTotal - kit.price;
}

export default function StorefrontClient({
  store,
  products,
  banners,
  kits,
  reviews: initialReviews,
  neighborhoods,
  storeReviews,
  recipe,
}: {
  store: Store;
  products: Product[];
  banners: Banner[];
  kits: Kit[];
  reviews: Review[];
  neighborhoods: Neighborhood[];
  storeReviews: StoreReviewSummary[];
  recipe: Recipe | null;
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
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [confirmedDeliveryFee, setConfirmedDeliveryFee] = useState(0);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"combinar" | "pix" | "cartao">("combinar");
  const [pixQrCodeText, setPixQrCodeText] = useState<string | null>(null);
  const [pixQrCodeImage, setPixQrCodeImage] = useState<string | null>(null);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixError, setPixError] = useState<string | null>(null);
  const [pixPaid, setPixPaid] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardCpf, setCardCpf] = useState("");
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardPaid, setCardPaid] = useState(false);
  const [scratchPhone, setScratchPhone] = useState("");
  const [scratchResult, setScratchResult] = useState<{
    discount_percent: number;
    redeemed: boolean;
    already_existed: boolean;
  } | null>(null);
  const [scratchLoading, setScratchLoading] = useState(false);
  const [scratchError, setScratchError] = useState<string | null>(null);
  const [confirmedScratchDiscount, setConfirmedScratchDiscount] = useState(0);
  const [customerLoggedIn, setCustomerLoggedIn] = useState(false);
  const [customerAccountName, setCustomerAccountName] = useState<string | null>(null);
  const [customerRecord, setCustomerRecord] = useState<{
    cashback_balance: number;
    referral_code: string;
  } | null>(null);
  const [subscribingKitId, setSubscribingKitId] = useState<string | null>(null);
  const [subName, setSubName] = useState("");
  const [subPhone, setSubPhone] = useState("");
  const [subSaving, setSubSaving] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [subSuccessKitId, setSubSuccessKitId] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isIosInstallHint, setIsIosInstallHint] = useState(false);
  const [storeRating, setStoreRating] = useState(5);
  const [storeComment, setStoreComment] = useState("");
  const [submittingStoreReview, setSubmittingStoreReview] = useState(false);
  const [storeReviewSubmitted, setStoreReviewSubmitted] = useState(false);

  useEffect(() => {
    const customerSupabase = getCustomerSupabase();

    async function loadCustomerAccount(userId: string | undefined) {
      if (!userId) {
        setCustomerLoggedIn(false);
        setCustomerAccountName(null);
        setCustomerRecord(null);
        return;
      }
      setCustomerLoggedIn(true);
      const [{ data: profile }, { data: record }] = await Promise.all([
        customerSupabase.from("customer_profiles").select("full_name").eq("id", userId).maybeSingle(),
        customerSupabase
          .from("customers")
          .select("cashback_balance, referral_code")
          .eq("store_id", store.id)
          .eq("profile_id", userId)
          .maybeSingle(),
      ]);
      setCustomerAccountName(profile?.full_name ?? null);
      setCustomerRecord(record ?? null);
    }

    customerSupabase.auth.getSession().then(({ data: { session } }) => {
      loadCustomerAccount(session?.user.id);
    });

    const {
      data: { subscription },
    } = customerSupabase.auth.onAuthStateChange((_event, session) => {
      loadCustomerAccount(session?.user.id);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleCustomerSignOut() {
    await getCustomerSupabase().auth.signOut();
    setCustomerLoggedIn(false);
    setCustomerAccountName(null);
    setCustomerRecord(null);
    setUseCashback(false);
  }

  const brandStyle = {
    "--brand-bg": store.brand_color,
    "--brand-text": readableTextColor(store.brand_color),
    "--accent-bg": store.accent_color,
    "--accent-text": readableTextColor(store.accent_color),
  } as React.CSSProperties;

  const kitsByProductId = useMemo(() => {
    const map = new Map<string, Kit[]>();
    for (const kit of kits) {
      for (const item of kit.kit_items) {
        const list = map.get(item.product_id) ?? [];
        list.push(kit);
        map.set(item.product_id, list);
      }
    }
    return map;
  }, [kits]);

  const cartItems = useMemo(() => {
    const lines: CartLine[] = [];
    for (const [key, quantity] of Object.entries(cart)) {
      if (quantity <= 0) continue;
      const [kind, id] = key.split(":") as ["product" | "kit", string];
      if (kind === "product") {
        const product = products.find((p) => p.id === id);
        if (product) {
          const unitPrice = effectivePrice(product);
          lines.push({
            key,
            kind,
            id,
            name: product.name,
            price: unitPrice,
            quantity,
            lineTotal:
              product.on_offer && product.offer_price !== null
                ? unitPrice * quantity
                : lineTotalFor(
                    unitPrice,
                    quantity,
                    product.promo_buy_qty,
                    product.promo_pay_qty,
                    product.price_wholesale,
                    product.wholesale_min_qty,
                  ),
          });
        }
      } else if (kind === "kit") {
        const kit = kits.find((k) => k.id === id);
        if (kit)
          lines.push({
            key,
            kind,
            id,
            name: `Kit: ${kit.name}`,
            price: kit.price,
            quantity,
            lineTotal: kit.price * quantity,
          });
      }
    }
    return lines;
  }, [cart, products, kits]);

  const total = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const storeStatus = useMemo(() => isStoreOpenNow(store), [store]);
  const deliveryFee =
    neighborhoodId === "retirada"
      ? 0
      : (neighborhoods.find((n) => n.id === neighborhoodId)?.fee ?? 0);
  const scratchDiscountPreview =
    scratchResult && !scratchResult.redeemed
      ? Math.round(total * (scratchResult.discount_percent / 100) * 100) / 100
      : 0;
  const totalWithDelivery =
    total - (couponPreview?.valid ? couponPreview.discount : 0) - scratchDiscountPreview + deliveryFee;

  const storeRatingAvg =
    storeReviews.length > 0
      ? storeReviews.reduce((sum, r) => sum + r.rating, 0) / storeReviews.length
      : 0;

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

  async function handleScratch() {
    setScratchError(null);
    const phone = scratchPhone.trim();
    if (phone.length < 10) {
      setScratchError("Digite um WhatsApp válido pra raspar.");
      return;
    }
    setScratchLoading(true);
    const { data, error: scratchRpcError } = await getCustomerSupabase().rpc("get_or_create_scratch_card", {
      p_store_id: store.id,
      p_customer_phone: phone,
    });
    setScratchLoading(false);
    if (scratchRpcError) {
      setScratchError(scratchRpcError.message);
      return;
    }
    setScratchResult(data?.[0] ?? null);
    if (!customerPhone.trim()) setCustomerPhone(phone);
  }

  async function handleSubscribe(kit: Kit) {
    setSubError(null);
    const phone = subPhone.trim();
    if (phone.length < 10) {
      setSubError("Digite um WhatsApp válido.");
      return;
    }
    setSubSaving(true);
    const { error: subInsertError } = await getSupabase().from("subscriptions").insert({
      store_id: store.id,
      customer_name: subName.trim() || null,
      customer_phone: phone,
      kit_id: kit.id,
      monthly_amount: kit.price,
      active: true,
    });
    setSubSaving(false);
    if (subInsertError) {
      setSubError("Não deu pra assinar: " + subInsertError.message);
      return;
    }
    setSubSuccessKitId(kit.id);
    setSubscribingKitId(null);
  }

  function addRecipeToCart() {
    if (!recipe) return;
    setCart((prev) => {
      const next = { ...prev };
      for (const item of recipe.ingredients) {
        const key = `product:${item.id}`;
        next[key] = (next[key] ?? 0) + item.qty;
      }
      return next;
    });
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

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const dismissKey = `mm_install_dismissed_${store.slug}`;
    if (localStorage.getItem(dismissKey)) return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const isIos = /iPad|iPhone|iPod/.test(window.navigator.userAgent);
    if (isIos) {
      setIsIosInstallHint(true);
      setShowInstallBanner(true);
      return;
    }

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, [store.slug]);

  function dismissInstallBanner() {
    setShowInstallBanner(false);
    localStorage.setItem(`mm_install_dismissed_${store.slug}`, "1");
  }

  async function handleInstallClick() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setShowInstallBanner(false);
  }

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

  useEffect(() => {
    if (paymentMethod === "cartao") {
      loadPagSeguroSdk().catch(() => {});
    }
  }, [paymentMethod]);

  useEffect(() => {
    if (!confirmedOrderId || !pixQrCodeText || pixPaid) return;
    const interval = setInterval(async () => {
      const { data } = await getSupabase()
        .from("orders")
        .select("pix_paid_at")
        .eq("id", confirmedOrderId)
        .maybeSingle();
      if (data?.pix_paid_at) {
        setPixPaid(true);
        clearInterval(interval);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [confirmedOrderId, pixQrCodeText, pixPaid]);

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

    if (neighborhoodId !== "retirada" && !deliveryAddress.trim()) {
      setError("Preencha o endereço de entrega.");
      return;
    }

    setSaving(true);
    // O preço e a baixa de estoque são recalculados no banco (função
    // "checkout") — o navegador só manda produto e quantidade, nunca preço,
    // pra ninguém conseguir adulterar o valor do pedido pelo devtools.
    const { data, error: rpcError } = await getCustomerSupabase().rpc("checkout", {
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
      p_delivery_address: neighborhoodId === "retirada" ? undefined : deliveryAddress.trim(),
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
    setConfirmedScratchDiscount(data?.[0]?.scratch_discount ?? 0);
    const newOrderId = data?.[0]?.order_id ?? null;
    setConfirmedOrderId(newOrderId);
    setView("confirmado");

    if (paymentMethod === "pix" && newOrderId) {
      setPixLoading(true);
      setPixError(null);
      try {
        const res = await fetch("/api/pagbank/create-pix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: newOrderId }),
        });
        const pixData = await res.json();
        if (!res.ok) {
          setPixError(
            "Não deu pra gerar o Pix agora — combine o pagamento direto com a loja pelo WhatsApp.",
          );
        } else {
          setPixQrCodeText(pixData.qr_code_text ?? null);
          setPixQrCodeImage(pixData.qr_code_image ?? null);
        }
      } catch {
        setPixError(
          "Não deu pra gerar o Pix agora — combine o pagamento direto com a loja pelo WhatsApp.",
        );
      } finally {
        setPixLoading(false);
      }
    }

    if (paymentMethod === "cartao" && newOrderId) {
      setCardLoading(true);
      setCardError(null);
      try {
        await loadPagSeguroSdk();
        const keyRes = await fetch("/api/pagbank/public-key", { method: "POST" });
        const keyData = await keyRes.json();
        if (!keyRes.ok || !keyData.public_key) {
          throw new Error("no-public-key");
        }

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
              order_id: newOrderId,
              encrypted_card: card.encryptedCard,
              holder_name: cardHolder,
              holder_cpf: cardCpf,
            }),
          });
          const chargeData = await chargeRes.json();
          if (!chargeRes.ok || !chargeData.paid) {
            setCardError(
              chargeData.reason ||
                "Não deu pra aprovar o cartão agora — combine o pagamento direto com a loja pelo WhatsApp.",
            );
          } else {
            setCardPaid(true);
          }
        }
      } catch {
        setCardError(
          "Não deu pra processar o cartão agora — combine o pagamento direto com a loja pelo WhatsApp.",
        );
      } finally {
        setCardLoading(false);
      }
    }

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

  async function handleSubmitStoreReview() {
    if (submittingStoreReview) return;
    setSubmittingStoreReview(true);
    const { error: reviewError } = await getSupabase().from("store_reviews").insert({
      store_id: store.id,
      customer_name: customerName.trim() || "Cliente",
      rating: storeRating,
      comment: storeComment.trim() || null,
    });
    setSubmittingStoreReview(false);
    if (!reviewError) setStoreReviewSubmitted(true);
  }

  if (view === "confirmado") {
    const finalTotal = confirmedTotal ?? total;
    const itemLines = cartItems
      .map((item) => `• ${item.quantity}x ${item.name} — ${formatCurrency(item.lineTotal)}`)
      .join("\n");
    const whatsappMessage = encodeURIComponent(
      [
        `Olá! Acabei de fazer um pedido na ${store.name}:`,
        "",
        itemLines,
        "",
        `Total: ${formatCurrency(finalTotal)}`,
        ...(customerName.trim() ? [`Nome: ${customerName.trim()}`] : []),
        ...(neighborhoodId !== "retirada" && deliveryAddress.trim()
          ? [`Endereço: ${deliveryAddress.trim()}`]
          : []),
      ].join("\n"),
    );
    return (
      <div
        style={brandStyle}
        className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#f5f6f8] px-6 py-24 text-center dark:bg-slate-950"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand-bg)] text-2xl font-bold text-[var(--brand-text)] shadow-lg">
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
        {neighborhoodId !== "retirada" && deliveryAddress.trim() && (
          <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            Entrega em: {deliveryAddress.trim()}
          </p>
        )}
        {confirmedScratchDiscount > 0 && (
          <p className="text-sm text-purple-700 dark:text-purple-400">
            🎟️ {formatCurrency(confirmedScratchDiscount)} de desconto da raspadinha aplicado nesse pedido!
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
          <div className="mt-1 max-w-xs rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-slate-600 dark:text-slate-400">Indique a loja pra um amigo com seu código:</p>
            <p className="mt-1 text-lg font-bold tracking-wide text-[var(--brand-bg)]">
              {confirmedReferralCode}
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `${window.location.origin}/loja/${store.slug}?ref=${confirmedReferralCode}`,
                );
              }}
              className="mt-1 text-xs font-medium text-[var(--brand-bg)] underline"
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
            className="mt-2 rounded-full bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
          >
            Avisar a loja no WhatsApp
          </a>
        )}
        {confirmedOrderId && (
          <a
            href={`/loja/${store.slug}/pedido/${confirmedOrderId}`}
            className="text-sm font-medium text-[var(--brand-bg)] underline"
          >
            Ver recibo digital
          </a>
        )}

        {paymentMethod === "pix" && (
          <div className="mt-2 w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {pixLoading && (
              <p className="text-sm text-slate-500 dark:text-slate-400">Gerando o QR code do Pix…</p>
            )}
            {!pixLoading && pixError && (
              <p className="text-sm text-amber-700 dark:text-amber-400">{pixError}</p>
            )}
            {!pixLoading && !pixError && pixPaid && (
              <p className="text-sm font-semibold text-green-700 dark:text-green-400">✓ Pagamento confirmado!</p>
            )}
            {!pixLoading && !pixError && !pixPaid && pixQrCodeText && (
              <>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Pague com Pix pra confirmar mais rápido
                </p>
                {pixQrCodeImage && (
                  <img
                    src={pixQrCodeImage}
                    alt="QR code Pix"
                    className="mx-auto mt-2 h-40 w-40"
                  />
                )}
                <button
                  onClick={() => navigator.clipboard.writeText(pixQrCodeText)}
                  className="mt-2 w-full rounded-lg bg-[var(--accent-bg)] px-3 py-2 text-sm font-semibold text-[var(--accent-text)]"
                >
                  Copiar código Pix
                </button>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Aguardando pagamento… atualiza sozinho assim que cair.
                </p>
              </>
            )}
          </div>
        )}

        {paymentMethod === "cartao" && (
          <div className="mt-2 w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {cardLoading && (
              <p className="text-sm text-slate-500 dark:text-slate-400">Processando o cartão…</p>
            )}
            {!cardLoading && cardError && (
              <p className="text-sm text-amber-700 dark:text-amber-400">{cardError}</p>
            )}
            {!cardLoading && !cardError && cardPaid && (
              <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                ✓ Pagamento no cartão aprovado!
              </p>
            )}
          </div>
        )}

        <div className="mt-4 w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {storeReviewSubmitted ? (
            <p className="text-center text-sm text-green-700 dark:text-green-400">
              Obrigado pela avaliação! 🙏
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                O que achou da {store.name}?
              </p>
              <div className="mt-2 flex justify-center gap-1 text-2xl">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStoreRating(n)}
                    aria-label={`${n} estrela${n > 1 ? "s" : ""}`}
                    className={n <= storeRating ? "text-amber-500" : "text-slate-300 dark:text-slate-700"}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea
                value={storeComment}
                onChange={(e) => setStoreComment(e.target.value)}
                placeholder="Comentário (opcional)"
                rows={2}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
              <button
                onClick={handleSubmitStoreReview}
                disabled={submittingStoreReview}
                className="mt-2 w-full rounded-lg bg-[var(--accent-bg)] px-3 py-2 text-sm font-semibold text-[var(--accent-text)] disabled:opacity-60"
              >
                {submittingStoreReview ? "Enviando…" : "Enviar avaliação"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (view === "checkout") {
    return (
      <div style={brandStyle} className="flex flex-1 flex-col items-center bg-[#f5f6f8] px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
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
                  {item.lineTotal < item.price * item.quantity && (
                    <span className="ml-1 text-xs text-green-600">(promoção aplicada)</span>
                  )}
                </span>
                <span>{formatCurrency(item.lineTotal)}</span>
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
                  className="shrink-0 font-medium text-[var(--brand-bg)]"
                >
                  {copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleShareList}
                disabled={sharing}
                className="text-sm font-medium text-[var(--brand-bg)] underline disabled:opacity-50"
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
              {neighborhoodId !== "retirada" && (
                <div className="mt-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Endereço completo
                  </label>
                  <textarea
                    required
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Rua, número, complemento e ponto de referência"
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  />
                </div>
              )}
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
            {scratchDiscountPreview > 0 && (
              <p className="flex justify-between text-purple-700 dark:text-purple-400">
                <span>🎟️ Raspadinha ({scratchResult?.discount_percent}%)</span>
                <span>−{formatCurrency(scratchDiscountPreview)}</span>
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

            {customerLoggedIn ? (
              <details
                open
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
              >
                <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                  🔓 Logado como {customerAccountName ?? "cliente"}
                </summary>
                <div className="mt-2 space-y-2">
                  {customerRecord && customerRecord.cashback_balance > 0 && (
                    <p className="text-green-700 dark:text-green-400">
                      Saldo de cashback: {formatCurrency(customerRecord.cashback_balance)}
                    </p>
                  )}
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
                  {customerRecord?.referral_code && (
                    <p className="text-slate-600 dark:text-slate-400">
                      Seu código de indicação: <strong>{customerRecord.referral_code}</strong>
                    </p>
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
                  <button
                    type="button"
                    onClick={handleCustomerSignOut}
                    className="text-xs text-slate-500 underline dark:text-slate-400"
                  >
                    Sair da conta
                  </button>
                </div>
              </details>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-900/50">
                <p className="text-slate-600 dark:text-slate-400">
                  🔒 Crie uma conta grátis (ou entre) pra ganhar cashback, usar a raspadinha e o programa
                  de indicação nesse pedido. Sem conta, seu pedido continua funcionando normalmente, só
                  sem esses benefícios.
                </p>
                <div className="mt-2 flex gap-2">
                  <a
                    href={`/cliente/entrar?loja=${store.slug}`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  >
                    Entrar
                  </a>
                  <a
                    href={`/cliente/cadastro?loja=${store.slug}`}
                    className="rounded-lg bg-[var(--brand-bg)] px-3 py-1.5 text-xs font-medium text-[var(--brand-text)]"
                  >
                    Criar conta grátis
                  </a>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Forma de pagamento
              </label>
              <div className="mt-1 space-y-1.5">
                <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "combinar"}
                    onChange={() => setPaymentMethod("combinar")}
                  />
                  Combinar direto com a loja (dinheiro, cartão na entrega, etc.)
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "pix"}
                    onChange={() => setPaymentMethod("pix")}
                  />
                  Pix — pagar agora e confirmar na hora
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "cartao"}
                    onChange={() => setPaymentMethod("cartao")}
                  />
                  Cartão de crédito — pagar agora
                </label>
              </div>
              {paymentMethod === "cartao" && (
                <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <input
                    required
                    inputMode="numeric"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="Número do cartão"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  />
                  <input
                    required
                    value={cardHolder}
                    onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                    placeholder="Nome impresso no cartão"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  />
                  <div className="flex gap-2">
                    <input
                      required
                      inputMode="numeric"
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(e.target.value)}
                      placeholder="Validade MM/AA"
                      className="w-1/2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    />
                    <input
                      required
                      inputMode="numeric"
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value)}
                      placeholder="CVV"
                      className="w-1/2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    />
                  </div>
                  <input
                    required
                    inputMode="numeric"
                    value={cardCpf}
                    onChange={(e) => setCardCpf(e.target.value)}
                    placeholder="CPF do titular do cartão"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Pagamento à vista (1x). Seus dados de cartão são criptografados no seu
                    navegador antes de sair daqui.
                  </p>
                </div>
              )}
            </div>

            {!storeStatus.open && storeStatus.message && (
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                🕒 {storeStatus.message}
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={saving || !storeStatus.open}
              className="w-full rounded-full bg-[var(--accent-bg)] px-4 py-3 font-semibold text-[var(--accent-text)] shadow-sm transition hover:brightness-110 disabled:opacity-60"
            >
              {saving ? "Enviando…" : "Enviar pedido"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={brandStyle} className="flex flex-1 flex-col bg-[#f5f6f8] pb-28 dark:bg-slate-950">
      <header className="relative overflow-hidden bg-[var(--brand-bg)] px-6 pb-10 pt-10 text-center text-[var(--brand-text)] sm:pb-14 sm:pt-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, currentColor 1.5px, transparent 1.5px), radial-gradient(circle at 60% 70%, currentColor 1.5px, transparent 1.5px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--brand-text)]/15 text-2xl font-bold ring-1 ring-inset ring-[var(--brand-text)]/25 backdrop-blur-sm sm:h-20 sm:w-20 sm:text-3xl">
            {store.name.slice(0, 2).toUpperCase()}
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-balance sm:text-4xl">{store.name}</h1>
          {storeReviews.length > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-text)]/10 px-3 py-1 text-xs font-medium sm:text-sm">
              <span className="tracking-tight text-amber-300">
                {"★".repeat(Math.round(storeRatingAvg))}
                {"☆".repeat(5 - Math.round(storeRatingAvg))}
              </span>
              <span>
                {storeRatingAvg.toFixed(1)} · {storeReviews.length}{" "}
                {storeReviews.length === 1 ? "avaliação" : "avaliações"}
              </span>
            </p>
          )}
        </div>
      </header>

      {!storeStatus.open && storeStatus.message && (
        <div className="bg-amber-100 px-4 py-2.5 text-center text-sm font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          🕒 {storeStatus.message} Você pode ver o catálogo, mas o pedido só é enviado quando a loja
          reabrir.
        </div>
      )}

      {showInstallBanner && (
        <div className="flex items-center justify-between gap-3 bg-slate-900 px-4 py-2.5 text-sm text-white">
          {isIosInstallHint ? (
            <span>
              📲 Instale esse site como app: toque em <strong>Compartilhar</strong> e depois em{" "}
              <strong>Adicionar à Tela de Início</strong>.
            </span>
          ) : (
            <span>📲 Instale a {store.name} como app no seu celular pra acessar mais rápido.</span>
          )}
          <div className="flex shrink-0 items-center gap-3">
            {!isIosInstallHint && (
              <button
                onClick={handleInstallClick}
                className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-900"
              >
                Instalar
              </button>
            )}
            <button
              onClick={dismissInstallBanner}
              aria-label="Fechar"
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {store.scratch_enabled && (
        <div className="mx-auto w-full max-w-5xl px-4 pt-5 sm:px-6">
          <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 shadow-sm dark:border-purple-900 dark:bg-purple-950/40">
            <p className="text-xs font-bold uppercase tracking-wide text-purple-700 dark:text-purple-400">
              🎟️ Raspadinha semanal
            </p>
            {!customerLoggedIn ? (
              <>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Entre na sua conta (grátis) pra raspar e tentar ganhar um desconto na sua compra dessa
                  semana.
                </p>
                <div className="mt-2 flex gap-2">
                  <a
                    href={`/cliente/entrar?loja=${store.slug}`}
                    className="rounded-lg border border-purple-300 px-3 py-1.5 text-xs font-medium text-purple-800 dark:border-purple-800 dark:text-purple-300"
                  >
                    Entrar
                  </a>
                  <a
                    href={`/cliente/cadastro?loja=${store.slug}`}
                    className="rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Criar conta grátis
                  </a>
                </div>
              </>
            ) : !scratchResult ? (
              <>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Digite seu WhatsApp e raspe pra tentar ganhar um desconto na sua compra dessa semana.
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    type="tel"
                    value={scratchPhone}
                    onChange={(e) => setScratchPhone(e.target.value)}
                    placeholder="Seu WhatsApp"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                  <button
                    onClick={handleScratch}
                    disabled={scratchLoading}
                    className="shrink-0 rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {scratchLoading ? "Raspando…" : "Raspar"}
                  </button>
                </div>
                {scratchError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{scratchError}</p>}
              </>
            ) : scratchResult.redeemed ? (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Você já usou a raspadinha dessa semana ({scratchResult.discount_percent}% de desconto).
                Volta semana que vem!
              </p>
            ) : (
              <p className="mt-1 text-sm text-purple-800 dark:text-purple-300">
                🎉 Você ganhou <strong>{scratchResult.discount_percent}% de desconto</strong>! Ele é
                aplicado automaticamente quando você finalizar o pedido com esse mesmo WhatsApp, até o
                fim da semana.
              </p>
            )}
          </div>
        </div>
      )}

      {recipe && (
        <div className="mx-auto w-full max-w-5xl px-4 pt-5 sm:px-6">
          <div className="flex items-center gap-4 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm dark:border-amber-900 dark:bg-amber-950/40">
            {recipe.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={recipe.image_url} alt={recipe.name} className="h-24 w-24 shrink-0 object-cover sm:h-28 sm:w-28" />
            )}
            <div className="min-w-0 flex-1 py-2 pr-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                🍳 Receita da semana
              </p>
              <p className="truncate font-semibold text-slate-900 dark:text-slate-50">{recipe.name}</p>
              {recipe.description && (
                <p className="truncate text-xs text-slate-600 dark:text-slate-400">{recipe.description}</p>
              )}
              <button
                onClick={addRecipeToCart}
                className="mt-1.5 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-sm transition hover:bg-amber-300"
              >
                Adicionar tudo ao carrinho
              </button>
            </div>
          </div>
        </div>
      )}

      {banners.length > 0 && (
        <div className="mx-auto w-full max-w-5xl px-4 pt-5 sm:px-6">
          <div className="flex snap-x gap-4 overflow-x-auto pb-1">
            {banners.map((banner) => {
              const content = (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={banner.image_url}
                  alt={banner.title}
                  className="h-40 w-full shrink-0 snap-start rounded-2xl object-cover shadow-sm sm:h-52 sm:w-[26rem]"
                />
              );
              return banner.link_url ? (
                <a
                  key={banner.id}
                  href={banner.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 transition hover:opacity-90"
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

      {categories.length > 1 && (
        <nav className="sticky top-0 z-20 mt-5 border-y border-slate-200 bg-[#f5f6f8]/95 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 sm:px-6">
            {kits.length > 0 && (
              <a
                href="#kits-section"
                className="shrink-0 rounded-full border border-slate-300 px-3.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-[var(--brand-bg)] hover:text-[var(--brand-bg)] dark:border-slate-700 dark:text-slate-300"
              >
                🎁 Kits
              </a>
            )}
            {categories.map(([category]) => (
              <a
                key={category}
                href={`#cat-${category}`}
                className="shrink-0 rounded-full border border-slate-300 px-3.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-[var(--brand-bg)] hover:text-[var(--brand-bg)] dark:border-slate-700 dark:text-slate-300"
              >
                {category}
              </a>
            ))}
          </div>
        </nav>
      )}

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-7 sm:px-6">
        {products.length === 0 && kits.length === 0 && (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Essa loja ainda não cadastrou produtos.
          </p>
        )}

        {kits.length > 0 && (
          <section id="kits-section" className="mb-9 scroll-mt-16">
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-50">
              <span aria-hidden>🎁</span> Kits e combos
            </h2>
            <div className="space-y-3">
              {kits.map((kit) => {
                const key = `kit:${kit.id}`;
                const quantity = cart[key] ?? 0;
                const maxQty = kitMaxQuantity(kit);
                const savings = kitSavings(kit);
                return (
                  <div
                    key={kit.id}
                    className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                  >
                  <div className="flex items-center gap-4">
                    {kit.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={kit.image_url}
                        alt={kit.name}
                        className="h-20 w-20 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-2xl dark:bg-purple-950/40">
                        🎁
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900 dark:text-slate-50">
                        {kit.name}
                      </p>
                      <p className="text-base font-bold text-slate-900 dark:text-slate-50">
                        {formatCurrency(kit.price)}
                      </p>
                      <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                        {kit.kit_items
                          .map((item) => `${item.quantity}x ${item.products?.name ?? ""}`)
                          .join(", ")}
                      </p>
                      {savings > 0.005 && (
                        <p className="mt-0.5 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                          Economize {formatCurrency(savings)}
                        </p>
                      )}
                      {maxQty <= 0 && <p className="text-xs text-red-500">Sem estoque</p>}
                    </div>
                    {quantity === 0 ? (
                      <button
                        onClick={() => setQuantity(key, 1)}
                        disabled={maxQty <= 0}
                        className="shrink-0 rounded-full bg-[var(--accent-bg)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] shadow-sm transition hover:brightness-110 disabled:opacity-40"
                      >
                        Adicionar
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2.5 rounded-full bg-slate-100 px-1 py-1 dark:bg-slate-800">
                        <button
                          onClick={() => setQuantity(key, quantity - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm dark:bg-slate-700 dark:text-slate-200"
                          aria-label="Diminuir quantidade"
                        >
                          −
                        </button>
                        <span className="w-4 text-center text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {quantity}
                        </span>
                        <button
                          onClick={() => setQuantity(key, Math.min(quantity + 1, maxQty))}
                          disabled={quantity >= maxQty}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm disabled:opacity-40 dark:bg-slate-700 dark:text-slate-200"
                          aria-label="Aumentar quantidade"
                        >
                          +
                        </button>
                      </div>
                    )}
                    </div>
                    {subSuccessKitId === kit.id ? (
                      <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        ✓ Assinatura feita! A loja vai gerar seu pedido desse kit todo mês.
                      </p>
                    ) : subscribingKitId === kit.id ? (
                      <div className="mt-2 flex flex-col gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                        <input
                          type="text"
                          value={subName}
                          onChange={(e) => setSubName(e.target.value)}
                          placeholder="Seu nome"
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                        />
                        <input
                          type="tel"
                          value={subPhone}
                          onChange={(e) => setSubPhone(e.target.value)}
                          placeholder="Seu WhatsApp"
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                        />
                        {subError && <p className="text-xs text-red-600 dark:text-red-400">{subError}</p>}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSubscribe(kit)}
                            disabled={subSaving}
                            className="rounded-lg bg-[var(--accent-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-text)] disabled:opacity-60"
                          >
                            {subSaving ? "Assinando…" : "Confirmar assinatura"}
                          </button>
                          <button
                            onClick={() => setSubscribingKitId(null)}
                            className="text-xs font-medium text-slate-500 dark:text-slate-400"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setSubscribingKitId(kit.id);
                          setSubError(null);
                        }}
                        className="mt-1 text-xs font-medium text-purple-700 underline dark:text-purple-400"
                      >
                        📦 Assinar esse kit todo mês
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {categories.map(([category, items]) => (
          <section key={category} id={`cat-${category}`} className="mb-9 scroll-mt-16">
            <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-slate-50">{category}</h2>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {items.map((product) => {
                const key = `product:${product.id}`;
                const quantity = cart[key] ?? 0;
                const rating = ratingsByProduct.get(product.id);
                const productReviews = reviews.filter((r) => r.product_id === product.id);
                const isExpanded = expandedProductId === product.id;
                return (
                  <div
                    key={product.id}
                    className={`group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${isExpanded ? "col-span-2 sm:col-span-3 lg:col-span-4" : ""}`}
                  >
                    <div className={isExpanded ? "flex flex-col sm:flex-row" : ""}>
                      <div className={isExpanded ? "sm:w-56 sm:shrink-0" : ""}>
                        <div className="relative aspect-square w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                          {product.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-3xl text-slate-300 dark:text-slate-700">
                              🛒
                            </div>
                          )}
                          <div className="absolute left-2 top-2 flex flex-col gap-1">
                            {product.on_offer && product.offer_price !== null && (
                              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                                Oferta
                              </span>
                            )}
                            {isNewProduct(product.created_at) && (
                              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                                Novo
                              </span>
                            )}
                          </div>
                          {product.stock <= 0 && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px] dark:bg-slate-900/70">
                              <span className="rounded-full bg-slate-900/90 px-3 py-1 text-xs font-semibold text-white">
                                Sem estoque
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-1 flex-col p-3">
                        <p className="line-clamp-2 min-h-[2.5em] text-sm font-medium leading-tight text-slate-900 dark:text-slate-50">
                          {product.name}
                        </p>

                        <div className="mt-1.5">
                          {product.on_offer && product.offer_price !== null ? (
                            <p className="flex items-baseline gap-1.5">
                              <span className="text-base font-bold text-red-600">
                                {formatCurrency(product.offer_price)}
                              </span>
                              <span className="text-xs text-slate-400 line-through dark:text-slate-500">
                                {formatCurrency(product.price)}
                              </span>
                            </p>
                          ) : (
                            <p className="text-base font-bold text-slate-900 dark:text-slate-50">
                              {formatCurrency(product.price)}
                            </p>
                          )}
                        </div>

                        {!product.on_offer && product.promo_buy_qty && product.promo_pay_qty && (
                          <p className="mt-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            Leve {product.promo_buy_qty}, pague {product.promo_pay_qty}
                          </p>
                        )}
                        {!product.on_offer &&
                          product.price_wholesale &&
                          product.wholesale_min_qty && (
                            <p className="mt-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                              {product.wholesale_min_qty}+un: {formatCurrency(product.price_wholesale)} cada
                            </p>
                          )}
                        {(() => {
                          const kitsWithProduct = kitsByProductId.get(product.id);
                          if (!kitsWithProduct || kitsWithProduct.length === 0) return null;
                          const firstKit = kitsWithProduct[0];
                          const savings = kitSavings(firstKit);
                          return (
                            <a
                              href="#kits-section"
                              className="mt-0.5 block truncate text-xs font-medium text-purple-700 underline dark:text-purple-400"
                            >
                              🎁 No kit &quot;{firstKit.name}&quot;
                              {savings > 0.005 ? ` — economize ${formatCurrency(savings)}` : ""}
                            </a>
                          );
                        })()}

                        <button
                          type="button"
                          onClick={() => setExpandedProductId(isExpanded ? null : product.id)}
                          className="mt-1 self-start text-xs text-slate-500 underline decoration-slate-300 hover:text-[var(--brand-bg)] dark:text-slate-400"
                        >
                          {rating
                            ? `${"★".repeat(Math.round(rating.avg))}${"☆".repeat(5 - Math.round(rating.avg))} (${rating.count})`
                            : "Avaliar produto"}
                        </button>

                        <div className="mt-auto pt-2.5">
                          {quantity === 0 ? (
                            <button
                              onClick={() => setQuantity(key, 1)}
                              disabled={product.stock <= 0}
                              className="w-full rounded-full bg-[var(--accent-bg)] px-3 py-2 text-sm font-semibold text-[var(--accent-text)] shadow-sm transition hover:brightness-110 disabled:opacity-40"
                            >
                              Adicionar
                            </button>
                          ) : (
                            <div className="flex w-full items-center justify-between rounded-full bg-slate-100 px-1 py-1 dark:bg-slate-800">
                              <button
                                onClick={() => setQuantity(key, quantity - 1)}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm dark:bg-slate-700 dark:text-slate-200"
                                aria-label="Diminuir quantidade"
                              >
                                −
                              </button>
                              <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                {quantity}
                              </span>
                              <button
                                onClick={() => setQuantity(key, Math.min(quantity + 1, product.stock))}
                                disabled={quantity >= product.stock}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm disabled:opacity-40 dark:bg-slate-700 dark:text-slate-200"
                                aria-label="Aumentar quantidade"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-100 p-4 dark:border-slate-800">
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

                        <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2 dark:border-slate-800">
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
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 sm:col-span-2"
                          />
                          <button
                            type="button"
                            onClick={() => handleSubmitReview(product.id)}
                            disabled={!reviewerName.trim() || submittingReview}
                            className="w-full rounded-full bg-[var(--accent-bg)] px-3 py-2 text-sm font-semibold text-[var(--accent-text)] disabled:opacity-50 sm:col-span-2"
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

      <footer className="mx-auto w-full max-w-5xl px-4 pb-8 pt-4 text-center text-xs text-slate-400 sm:px-6 dark:text-slate-600">
        <a href="/privacidade" className="underline">
          Aviso de privacidade
        </a>
        {" · "}
        <a href="/termos" className="underline">
          Termo de uso
        </a>
      </footer>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4 sm:px-6">
          <button
            onClick={() => setView("checkout")}
            className="mx-auto flex w-full max-w-5xl items-center justify-between rounded-2xl bg-[var(--accent-bg)] px-5 py-3.5 font-semibold text-[var(--accent-text)] shadow-xl shadow-black/10 ring-1 ring-black/5 transition hover:brightness-110"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--accent-text)]/20 px-1.5 text-xs">
                {cartCount}
              </span>
              Ver carrinho
            </span>
            <span>{formatCurrency(total)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
