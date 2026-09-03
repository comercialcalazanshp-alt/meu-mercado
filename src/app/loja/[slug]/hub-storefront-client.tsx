"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { getCustomerSupabase } from "@/lib/supabase-customer";
import {
  type Product,
  type Neighborhood,
  type Store,
  type Banner,
  type PagSeguroSdk,
  effectivePrice,
  lineTotalFor,
  formatCurrency,
  readableTextColor,
  storeInitials,
  isOfferActive,
  isNewProduct,
  groupProductsByCategory,
  loadPagSeguroSdk,
  detectVisitSource,
} from "@/lib/storefront-pricing";
import { BannerOverlay } from "@/components/BannerOverlay";
import { categoryIcon } from "@/lib/hub-categories";
import {
  Home as HomeIcon,
  Search,
  LayoutGrid,
  ShoppingCart,
  User,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  MessageCircle,
  Package,
  ShieldCheck,
} from "lucide-react";

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
  minOrderEnabled: boolean;
  minOrderValue: number;
  freeDeliveryEnabled: boolean;
  freeDeliveryThreshold: number;
};

type OfferProduct = Product & {
  store_id: string;
  store_name: string;
  store_slug: string;
  brand_color: string;
  accent_color: string;
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

type View = "inicio" | "modulos" | "modulo" | "carrinho" | "entrega" | "pagamento" | "confirmado" | "conta";

const ACCOUNT_ORDER_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  confirmado: "Confirmado",
  entregando: "A caminho",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

function cartKey(storeId: string, productId: string) {
  return `${storeId}|${productId}`;
}

// Cromo neutro da plataforma — não é a brand_color de nenhum afiliado, de
// propósito: o cliente está numa vitrine com vários módulos, não "dentro"
// da loja de um afiliado específico, exceto quando ele entra num módulo.
const PLATFORM_BG = "#0B1220";
const PLATFORM_SURFACE = "#111C34";
// Acento da PLATAFORMA (botões de Carrinho/Entrega/Pagamento, nav ativa) —
// deliberadamente não é a accent_color de nenhum afiliado, pra não
// favorecer visualmente quem já está no carrinho por acaso.
const PLATFORM_ACCENT = "#F5A524";
const PLATFORM_ACCENT_TEXT = "#1A1200";
const FONT_DISPLAY = { fontFamily: "var(--font-sora)" };
const FONT_BODY = { fontFamily: "var(--font-manrope)" };

export default function HubStorefrontClient({ hubStore, modules }: { hubStore: Store; modules: HubModule[] }) {
  const allModules: HubModule[] = useMemo(
    () => [
      {
        partnership_id: "hub",
        category: "Mercado",
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
  const lastOrderStorageKey = `hub-last-order:${hubStore.id}`;

  const [view, setView] = useState<View>("inicio");
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, ModuleCatalog>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartLoaded, setCartLoaded] = useState(false);

  const [homeOffers, setHomeOffers] = useState<OfferProduct[]>([]);
  const [homeOffersLoading, setHomeOffersLoading] = useState(true);
  const [homeBanners, setHomeBanners] = useState<(Banner & { store_id: string })[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OfferProduct[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [moduleSearch, setModuleSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const [lastOrderId, setLastOrderId] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCpf, setCustomerCpf] = useState("");
  const [customerLoggedIn, setCustomerLoggedIn] = useState(false);
  const [customerAccountName, setCustomerAccountName] = useState<string | null>(null);
  const [hubCustomerSummary, setHubCustomerSummary] = useState<
    { store_id: string; store_name: string; brand_color: string; cashback_balance: number; referral_code: string }[]
  >([]);
  const [hubOrders, setHubOrders] = useState<
    {
      order_id: string;
      hub_order_id: string;
      store_id: string;
      store_name: string;
      items: { name: string; quantity: number }[];
      total: number;
      status: string;
      created_at: string;
      cashback_earned: number;
      payment_method: string | null;
    }[]
  >([]);
  const [loadingAccountData, setLoadingAccountData] = useState(false);
  const [accountDataLoaded, setAccountDataLoaded] = useState(false);
  const [deliveryByStore, setDeliveryByStore] = useState<Record<string, { neighborhoodId: string; address: string }>>({});
  const [paymentMethod, setPaymentMethod] = useState<"dinheiro" | "cartao_entrega" | "pix" | "cartao">("dinheiro");
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
  const [cardInstallments, setCardInstallments] = useState(1);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardPaid, setCardPaid] = useState(false);

  const [confirmedHubOrderId, setConfirmedHubOrderId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptRow[] | null>(null);

  // Carrinho fica numa chave própria do hub — visitar um hub e uma loja
  // comum no mesmo navegador não deve misturar os dois carrinhos.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cartStorageKey);
      if (raw) setCart(JSON.parse(raw));
      setLastOrderId(localStorage.getItem(lastOrderStorageKey));
    } catch {
      // localStorage indisponível ou dado corrompido — segue vazio
    }
    setCartLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartStorageKey]);

  // Rastreio de visita do Hub — mesma RPC/lógica da loja única
  // (storefront-client.tsx), contra o store_id do próprio Hub (entrar
  // num módulo específico continua sendo visita do Hub como um todo).
  const visitStorageKey = `mm_visit_${hubStore.id}`;
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
        p_store_id: hubStore.id,
        p_session_id: sessionId,
        p_count_view: isNewSession,
        p_source: isNewSession ? detectVisitSource() : undefined,
      })
      .then(({ error }) => {
        if (error) console.error("Erro ao registrar visita:", error.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mesma conta de cliente da loja única (identidade única pra toda a
  // plataforma, ver lib/supabase-customer.ts) — só precisa checar a
  // sessão e pré-preencher nome/telefone se ainda estiverem vazios.
  useEffect(() => {
    const customerSupabase = getCustomerSupabase();

    async function loadCustomerAccount(userId: string | undefined) {
      if (!userId) {
        setCustomerLoggedIn(false);
        setCustomerAccountName(null);
        return;
      }
      const { data: profile } = await customerSupabase
        .from("customer_profiles")
        .select("full_name, phone")
        .eq("id", userId)
        .maybeSingle();
      if (!profile) {
        await customerSupabase.auth.signOut();
        setCustomerLoggedIn(false);
        setCustomerAccountName(null);
        return;
      }
      setCustomerLoggedIn(true);
      setCustomerAccountName(profile.full_name);
      setCustomerName((prev) => prev || profile.full_name || "");
      setCustomerPhone((prev) => prev || profile.phone || "");
    }

    customerSupabase.auth.getSession().then(({ data: { session } }) => {
      loadCustomerAccount(session?.user.id);
    });

    const {
      data: { subscription },
    } = customerSupabase.auth.onAuthStateChange((_event, session) => {
      loadCustomerAccount(session?.user.id);
      setAccountDataLoaded(false);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openAccountData() {
    if (accountDataLoaded || loadingAccountData || !customerLoggedIn) return;
    setLoadingAccountData(true);
    const customerSupabase = getCustomerSupabase();
    const [{ data: summary }, { data: ordersData }] = await Promise.all([
      customerSupabase.rpc("get_hub_customer_summary", { p_hub_store_id: hubStore.id }),
      customerSupabase.rpc("get_customer_hub_orders", { p_hub_store_id: hubStore.id }),
    ]);
    setHubCustomerSummary(summary ?? []);
    setHubOrders(ordersData ?? []);
    setAccountDataLoaded(true);
    setLoadingAccountData(false);
  }

  async function handleCustomerSignOut() {
    await getCustomerSupabase().auth.signOut();
    setCustomerLoggedIn(false);
    setCustomerAccountName(null);
    setHubCustomerSummary([]);
    setHubOrders([]);
    setAccountDataLoaded(false);
  }

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

  // "Ofertas perto de você" na Home — busca uma vez ao montar.
  useEffect(() => {
    setHomeOffersLoading(true);
    getSupabase()
      .rpc("get_hub_offers", { p_hub_store_id: hubStore.id, p_only_offers: true, p_limit: 12 })
      .then(({ data }) => {
        setHomeOffers((data as OfferProduct[]) ?? []);
        setHomeOffersLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubStore.id]);

  // Banners de divulgação da Home — de todas as lojas do hub, cada um leva
  // pra onde o próprio afiliado configurou (link_url já existe no banner,
  // mesma estrutura que a vitrine de loja única já usa).
  useEffect(() => {
    const storeIds = allModules.map((m) => m.store_id);
    getSupabase()
      .from("banners")
      .select("id, store_id, title, image_url, link_url, focal_x, focal_y, text_style, overlay_text")
      .in("store_id", storeIds)
      .order("created_at", { ascending: false })
      .then(({ data }) => setHomeBanners((data as (Banner & { store_id: string })[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubStore.id]);

  // Busca global (Home) — com debounce, cruzando todas as lojas do hub.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearchLoading(true);
    const timeout = setTimeout(() => {
      getSupabase()
        .rpc("get_hub_offers", { p_hub_store_id: hubStore.id, p_search: q, p_limit: 30 })
        .then(({ data }) => {
          setSearchResults((data as OfferProduct[]) ?? []);
          setSearchLoading(false);
        });
    }, 350);
    return () => clearTimeout(timeout);
  }, [searchQuery, hubStore.id]);

  async function loadCatalog(storeId: string) {
    setCatalogs((prev) => {
      if (prev[storeId]?.loaded || prev[storeId]?.loading) return prev;
      return {
        ...prev,
        [storeId]: { products: [], neighborhoods: [], loading: true, loaded: false, error: null, minOrderEnabled: false, minOrderValue: 0, freeDeliveryEnabled: false, freeDeliveryThreshold: 0 },
      };
    });
    if (catalogs[storeId]?.loaded || catalogs[storeId]?.loading) return;

    const supabase = getSupabase();
    const [{ data: products, error: productsError }, { data: neighborhoods }, { data: storeSettings }] = await Promise.all([
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
      supabase
        .from("stores")
        .select("min_order_for_delivery_enabled, min_order_for_delivery, free_delivery_threshold_enabled, free_delivery_threshold, hide_out_of_stock")
        .eq("id", storeId)
        .maybeSingle(),
    ]);

    const visibleProducts = storeSettings?.hide_out_of_stock ? (products ?? []).filter((p) => p.stock > 0) : (products ?? []);

    setCatalogs((prev) => ({
      ...prev,
      [storeId]: {
        products: visibleProducts,
        neighborhoods: neighborhoods ?? [],
        loading: false,
        loaded: true,
        error: productsError ? "Não deu pra carregar os produtos dessa loja. Tente de novo." : null,
        minOrderEnabled: storeSettings?.min_order_for_delivery_enabled ?? false,
        minOrderValue: storeSettings?.min_order_for_delivery ?? 0,
        freeDeliveryEnabled: storeSettings?.free_delivery_threshold_enabled ?? false,
        freeDeliveryThreshold: storeSettings?.free_delivery_threshold ?? 0,
      },
    }));
  }

  function openModule(storeId: string) {
    setActiveModuleId(storeId);
    setModuleSearch("");
    setActiveCategory(null);
    setView("modulo");
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
  const moduleById = useMemo(() => new Map(allModules.map((m) => [m.store_id, m])), [allModules]);

  const subtotal = cartItems.reduce((sum, l) => sum + l.lineTotal, 0);
  const cartCount = cartItems.reduce((sum, l) => sum + l.quantity, 0);

  const deliveryFeeTotal = storesInCart.reduce((sum, m) => {
    const choice = deliveryByStore[m.store_id];
    if (!choice || choice.neighborhoodId === "retirada" || !choice.neighborhoodId) return sum;
    const catalog = catalogs[m.store_id];
    const storeSubtotal = (cartByStore.get(m.store_id) ?? []).reduce((s, l) => s + l.lineTotal, 0);
    if (catalog?.freeDeliveryEnabled && catalog.freeDeliveryThreshold > 0 && storeSubtotal >= catalog.freeDeliveryThreshold) {
      return sum;
    }
    const n = catalog?.neighborhoods.find((x) => x.id === choice.neighborhoodId);
    return sum + (n?.fee ?? 0);
  }, 0);

  const totalGeral = subtotal + deliveryFeeTotal;

  // Adicionar direto de um card de oferta na Home, sem precisar abrir o
  // módulo antes — o catálogo daquela loja pode nem estar carregado ainda,
  // então guarda o produto num "catálogo parcial" pra o carrinho conseguir
  // achar o preço/estoque dele.
  function addOfferToCart(offer: OfferProduct) {
    setCatalogs((prev) => {
      const existing = prev[offer.store_id];
      if (existing?.products.some((p) => p.id === offer.id)) return prev;
      return {
        ...prev,
        [offer.store_id]: {
          products: [...(existing?.products ?? []), offer],
          neighborhoods: existing?.neighborhoods ?? [],
          loading: false,
          loaded: existing?.loaded ?? false,
          error: existing?.error ?? null,
          minOrderEnabled: existing?.minOrderEnabled ?? false,
          minOrderValue: existing?.minOrderValue ?? 0,
          freeDeliveryEnabled: existing?.freeDeliveryEnabled ?? false,
          freeDeliveryThreshold: existing?.freeDeliveryThreshold ?? 0,
        },
      };
    });
    setQuantity(offer.store_id, offer.id, (cart[cartKey(offer.store_id, offer.id)] ?? 0) + 1);
  }

  function goToCart() {
    if (cartItems.length === 0) {
      setError("Seu carrinho está vazio.");
      return;
    }
    setError(null);
    setView("carrinho");
  }

  function goToDelivery() {
    setView("entrega");
  }

  async function handleCheckout(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    if (cartItems.length === 0) {
      setError("Seu carrinho está vazio.");
      return;
    }
    for (const m of storesInCart) {
      const choice = deliveryByStore[m.store_id];
      const isDelivery = choice && choice.neighborhoodId !== "retirada" && choice.neighborhoodId;
      if (isDelivery && !choice.address?.trim()) {
        setError(`Preencha o endereço de entrega de "${m.store_name}".`);
        return;
      }
      const catalog = catalogs[m.store_id];
      if (isDelivery && catalog?.minOrderEnabled) {
        const storeSubtotal = (cartByStore.get(m.store_id) ?? []).reduce((s, l) => s + l.lineTotal, 0);
        if (storeSubtotal < catalog.minOrderValue) {
          setError(
            `Pedido mínimo pra entrega em "${m.store_name}" é ${formatCurrency(catalog.minOrderValue)} — faltam ${formatCurrency(catalog.minOrderValue - storeSubtotal)}.`,
          );
          return;
        }
      }
    }

    if (!window.confirm("Podemos confirmar esse pedido?")) return;

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
      p_payment_method: paymentMethod,
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
    setAccountDataLoaded(false);

    const visitSessionId = sessionStorage.getItem(visitStorageKey);
    if (visitSessionId) {
      getSupabase()
        .rpc("track_site_visit", { p_store_id: hubStore.id, p_session_id: visitSessionId, p_mark_converted: true, p_count_view: false })
        .then(({ error }) => {
          if (error) console.error("Erro ao registrar conversão:", error.message);
        });
    }

    if (customerLoggedIn) {
      const customerSupabase = getCustomerSupabase();
      const {
        data: { session: customerSession },
      } = await customerSupabase.auth.getSession();
      if (customerSession) {
        await customerSupabase.from("customer_profiles").update({ phone: customerPhone.trim() }).eq("id", customerSession.user.id);
      }
    }
    if (hubOrderId) {
      try {
        localStorage.setItem(lastOrderStorageKey, hubOrderId);
        setLastOrderId(hubOrderId);
      } catch {
        // sem storage — só não vai ter atalho de "meu último pedido"
      }
    }

    if (hubOrderId) {
      const { data: receiptData } = await getSupabase().rpc("get_hub_order_receipt", { p_hub_order_id: hubOrderId });
      setReceipt((receiptData as ReceiptRow[]) ?? null);
    }

    if (paymentMethod === "pix" && hubOrderId) {
      setPixLoading(true);
      setPixError(null);
      try {
        const res = await fetch("/api/efi/create-pix", {
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
              installments: cardInstallments,
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

  // ============================================================
  // Cromo comum: barra inferior (mobile)
  // ============================================================
  function BottomNav() {
    const items: { key: View; label: string; icon: typeof HomeIcon }[] = [
      { key: "inicio", label: "Início", icon: HomeIcon },
      { key: "inicio", label: "Buscar", icon: Search },
      { key: "modulos", label: "Categorias", icon: LayoutGrid },
      { key: "carrinho", label: "Carrinho", icon: ShoppingCart },
      { key: "conta", label: "Conta", icon: User },
    ];
    return (
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-white/10 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur-lg sm:hidden"
        style={{ backgroundColor: `${PLATFORM_SURFACE}f0` }}
      >
        {items.map((item, i) => {
          const isActive = view === item.key && !(item.label === "Buscar" && view === "inicio" && !searchFocusedRef.current);
          const isSearch = item.label === "Buscar";
          return (
            <button
              key={item.label}
              onClick={() => {
                setView(item.key);
                if (isSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
                if (item.key === "conta") openAccountData();
              }}
              className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium transition"
              style={{ color: isActive || (isSearch && i === 1 && view === "inicio") ? PLATFORM_ACCENT : "rgba(255,255,255,0.45)" }}
            >
              <item.icon size={20} strokeWidth={isActive ? 2.4 : 2} />
              {item.label}
              {item.key === "carrinho" && cartCount > 0 && (
                <span
                  key={cartCount}
                  className="animate-mm-badge-bump absolute mb-5 ml-6 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-[0_0_0_2px_rgba(0,0,0,0.3)]"
                >
                  {cartCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    );
  }
  const searchFocusedRef = useRef(false);

  // ============================================================
  // Cromo comum: barra flutuante do carrinho (aparece por cima dos
  // produtos enquanto o cliente navega, some quando o carrinho fica vazio)
  // ============================================================
  function FloatingCartBar() {
    if (cartCount === 0) return null;
    return (
      <div className="fixed inset-x-0 bottom-16 z-30 px-4 pb-3 sm:bottom-0 sm:left-60 sm:px-6 sm:pb-4">
        <button
          onClick={goToCart}
          className="mx-auto flex w-full max-w-2xl items-center justify-between rounded-2xl px-5 py-3.5 font-semibold shadow-xl shadow-black/30 transition active:scale-[0.99]"
          style={{ backgroundColor: PLATFORM_ACCENT, color: PLATFORM_ACCENT_TEXT, ...FONT_DISPLAY }}
        >
          <span className="flex items-center gap-2">
            <ShoppingCart size={18} />
            {cartCount} {cartCount === 1 ? "item" : "itens"}
          </span>
          <span key={subtotal} className="animate-mm-scale-in flex items-center gap-1.5">
            {formatCurrency(subtotal)}
            <ChevronRight size={18} />
          </span>
        </button>
      </div>
    );
  }

  // ============================================================
  // Cromo comum: barra lateral (desktop)
  // ============================================================
  function DesktopSidebar() {
    const navItems: { key: View; label: string; icon: typeof HomeIcon }[] = [
      { key: "inicio", label: "Início", icon: HomeIcon },
      { key: "modulos", label: "Categorias", icon: LayoutGrid },
      { key: "carrinho", label: "Carrinho", icon: ShoppingCart },
      { key: "conta", label: "Conta", icon: User },
    ];
    return (
      <aside
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/10 px-4 py-6 sm:flex"
        style={{ backgroundColor: PLATFORM_SURFACE }}
      >
        <button onClick={() => setView("inicio")} className="flex items-center gap-2.5 px-1 text-left">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
            style={{ backgroundColor: hubStore.brand_color, color: readableTextColor(hubStore.brand_color) }}
          >
            {storeInitials(hubStore.name)}
          </span>
          <span className="truncate text-sm font-bold text-white" style={FONT_DISPLAY}>
            {hubStore.name}
          </span>
        </button>

        <nav className="mt-8 flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => {
                  setView(item.key);
                  if (item.key === "conta") openAccountData();
                }}
                className="relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition"
                style={{ backgroundColor: isActive ? "rgba(255,255,255,0.08)" : "transparent", color: isActive ? "#fff" : "rgba(255,255,255,0.55)" }}
              >
                <item.icon size={18} strokeWidth={isActive ? 2.4 : 2} />
                {item.label}
                {item.key === "carrinho" && cartCount > 0 && (
                  <span
                    key={cartCount}
                    className="animate-mm-badge-bump ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                  >
                    {cartCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <p className="mb-2 mt-8 px-3 text-[10px] font-semibold uppercase tracking-wide text-white/35">Módulos</p>
        <nav className="flex flex-col gap-1">
          {allModules.map((m) => {
            const Icon = categoryIcon(m.category);
            const isActive = view === "modulo" && activeModuleId === m.store_id;
            return (
              <button
                key={m.store_id}
                onClick={() => openModule(m.store_id)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition"
                style={{ backgroundColor: isActive ? "rgba(255,255,255,0.08)" : "transparent", color: isActive ? "#fff" : "rgba(255,255,255,0.55)" }}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: m.brand_color }}>
                  <Icon size={14} color={readableTextColor(m.brand_color)} />
                </span>
                <span className="truncate">{m.store_name}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-1 pt-6">
          {lastOrderId && (
            <a href={`/loja/${hubStore.slug}/pedido-hub/${lastOrderId}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/55 transition hover:text-white">
              <Package size={18} />
              Meu último pedido
            </a>
          )}
          {hubStore.whatsapp && (
            <a
              href={`https://wa.me/55${hubStore.whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/55 transition hover:text-white"
            >
              <MessageCircle size={18} />
              Ajuda
            </a>
          )}
        </div>
      </aside>
    );
  }

  // ============================================================
  // Tela: Início
  // ============================================================
  function HomeScreen() {
    const showingSearch = searchQuery.trim().length > 0;
    return (
      <div className={cartCount > 0 ? "flex flex-1 flex-col pb-40" : "flex flex-1 flex-col pb-24"}>
        <div
          className="rounded-b-[28px] px-4 pb-8 pt-5 shadow-lg shadow-black/30 sm:px-6"
          style={{ backgroundColor: PLATFORM_SURFACE }}
        >
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                style={{ backgroundColor: hubStore.brand_color, color: readableTextColor(hubStore.brand_color) }}
              >
                {storeInitials(hubStore.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-medium uppercase tracking-wide text-white/45">Bem-vindo a</p>
                <p className="-mt-0.5 truncate text-base font-bold text-white" style={FONT_DISPLAY}>
                  {hubStore.name}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="-mt-5 px-4 sm:px-6">
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => (searchFocusedRef.current = true)}
              onBlur={() => (searchFocusedRef.current = false)}
              placeholder="O que você está procurando?"
              className="w-full rounded-2xl border-0 bg-white py-3.5 pl-10 pr-4 text-sm text-slate-900 shadow-xl shadow-black/20 outline-none ring-1 ring-black/5 placeholder:text-slate-400"
            />
          </div>
        </div>

        {showingSearch ? (
          <div className="px-4 pt-5 sm:px-6">
            <p className="text-sm font-medium text-white/70">
              {searchLoading ? "Buscando…" : `${searchResults?.length ?? 0} resultado(s) pra "${searchQuery.trim()}"`}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {(searchResults ?? []).map((offer) => (
                <OfferCard key={`${offer.store_id}-${offer.id}`} offer={offer} />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 pt-7 sm:px-6">
              <h2 className="mb-3 text-sm font-bold text-white" style={FONT_DISPLAY}>
                Categorias
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {allModules.map((m, i) => {
                  const Icon = categoryIcon(m.category);
                  return (
                    <button
                      key={m.store_id}
                      onClick={() => openModule(m.store_id)}
                      className="animate-mm-fade-up group flex shrink-0 flex-col items-center gap-1.5"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <span
                        className="flex h-14 w-14 items-center justify-center rounded-2xl transition duration-200 group-hover:-translate-y-0.5 group-active:scale-90"
                        style={{ backgroundColor: m.brand_color, boxShadow: `0 10px 24px -8px ${m.brand_color}99` }}
                      >
                        <Icon size={24} color={readableTextColor(m.brand_color)} strokeWidth={2} />
                      </span>
                      <span className="max-w-[64px] truncate text-center text-[11px] font-medium text-white/80">{m.store_name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {homeBanners.length > 0 && (
              <div className="mt-6 px-4 sm:px-6">
                <div className="flex snap-x gap-3 overflow-x-auto pb-1">
                  {homeBanners.map((banner, bi) => {
                    const content = (
                      <div className="relative h-32 w-72 shrink-0 snap-start overflow-hidden rounded-2xl shadow-lg shadow-black/30 transition duration-300 group-hover:shadow-2xl sm:h-40 sm:w-96">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={banner.image_url}
                          alt={banner.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                          style={{ objectPosition: `${banner.focal_x * 100}% ${banner.focal_y * 100}%` }}
                        />
                        <BannerOverlay style={banner.text_style} text={banner.overlay_text} />
                      </div>
                    );
                    const animStyle = { animationDelay: `${Math.min(bi * 80, 320)}ms` };
                    return banner.link_url ? (
                      <a
                        key={banner.id}
                        href={banner.link_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="animate-mm-fade-up group shrink-0"
                        style={animStyle}
                        onClick={() => {
                          getSupabase().from("banner_clicks").insert({ store_id: banner.store_id, banner_id: banner.id });
                        }}
                      >
                        {content}
                      </a>
                    ) : (
                      <div key={banner.id} className="animate-mm-fade-up group shrink-0" style={animStyle}>
                        {content}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-6 px-4 sm:px-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white" style={FONT_DISPLAY}>
                  Ofertas perto de você
                </h2>
                <button onClick={() => setView("modulos")} className="text-xs font-semibold transition active:scale-95" style={{ color: PLATFORM_ACCENT }}>
                  Ver todas
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {homeOffersLoading &&
                  [0, 1, 2, 3].map((i) => (
                    <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-white/10">
                      <div className="animate-mm-shimmer absolute inset-0" />
                    </div>
                  ))}
                {!homeOffersLoading && homeOffers.length === 0 && (
                  <p className="col-span-2 text-sm text-white/50">Nenhuma oferta no momento.</p>
                )}
                {homeOffers.map((offer, i) => (
                  <div key={`${offer.store_id}-${offer.id}`} className="animate-mm-fade-up" style={{ animationDelay: `${i * 70}ms` }}>
                    <OfferCard offer={offer} />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        <FloatingCartBar />
      </div>
    );
  }

  function OfferCard({ offer }: { offer: OfferProduct }) {
    const price = effectivePrice(offer);
    const onOffer = isOfferActive(offer);
    const quantity = cart[cartKey(offer.store_id, offer.id)] ?? 0;
    return (
      <div
        className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-lg shadow-black/25 transition duration-300 hover:-translate-y-1 hover:shadow-2xl"
        style={{ boxShadow: `0 12px 28px -14px ${offer.brand_color}80` }}
      >
        <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
          {offer.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={offer.image_url}
              alt={offer.name}
              loading="lazy"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <Package size={28} />
            </div>
          )}
          {onOffer && (
            <span className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
              Oferta
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-2.5">
          <p className="line-clamp-2 min-h-[2.2em] text-xs font-medium leading-tight text-slate-900">{offer.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-slate-400">{offer.store_name}</p>
          {onOffer ? (
            <p className="mt-1 flex items-baseline gap-1">
              <span className="text-sm font-bold text-red-600">{formatCurrency(price)}</span>
              <span className="text-[10px] text-slate-400 line-through">{formatCurrency(offer.price)}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm font-bold" style={{ color: offer.brand_color }}>
              {formatCurrency(price)}
            </p>
          )}
          <div className="mt-auto pt-2">
            {quantity === 0 ? (
              <button
                onClick={() => addOfferToCart(offer)}
                style={{ backgroundColor: offer.accent_color, color: readableTextColor(offer.accent_color) }}
                className="flex w-full items-center justify-center gap-1 rounded-full px-2 py-1.5 text-xs font-semibold shadow-md transition active:scale-90"
              >
                <Plus size={13} /> Adicionar
              </button>
            ) : (
              <div className="animate-mm-scale-in flex w-full items-center justify-between rounded-full bg-slate-100 px-1 py-1">
                <button onClick={() => setQuantity(offer.store_id, offer.id, quantity - 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition active:scale-75">
                  <Minus size={12} />
                </button>
                <span key={quantity} className="animate-mm-scale-in text-xs font-semibold text-slate-900">
                  {quantity}
                </span>
                <button onClick={() => setQuantity(offer.store_id, offer.id, quantity + 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition active:scale-75">
                  <Plus size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // Tela: Escolha um módulo
  // ============================================================
  function ModulePickerScreen() {
    return (
      <div className="flex flex-1 flex-col pb-24">
        <div className="px-4 pb-5 pt-5 sm:px-6" style={{ backgroundColor: PLATFORM_SURFACE }}>
          <h1 className="text-xl font-bold text-white" style={FONT_DISPLAY}>
            Escolha um módulo
          </h1>
          <p className="mt-0.5 text-xs text-white/50">Cada módulo é uma loja parceira independente</p>
        </div>

        <div className="grid grid-cols-2 gap-3 px-4 pt-5 sm:grid-cols-3 sm:px-6 lg:grid-cols-4">
          {allModules.map((m, i) => {
            const Icon = categoryIcon(m.category);
            const count = catalogs[m.store_id]?.products.length;
            return (
              <button
                key={m.store_id}
                onClick={() => openModule(m.store_id)}
                className="animate-mm-fade-up group relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-3xl p-4 text-left transition duration-300 hover:-translate-y-1 active:scale-[0.97]"
                style={{ backgroundColor: m.brand_color, animationDelay: `${i * 80}ms`, boxShadow: `0 16px 32px -12px ${m.brand_color}b3` }}
              >
                <div
                  className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 transition duration-500 group-hover:scale-125"
                  style={{ backgroundColor: readableTextColor(m.brand_color) }}
                />
                <span
                  className="relative flex h-11 w-11 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: "rgba(255,255,255,0.18)" }}
                >
                  <Icon size={22} color={readableTextColor(m.brand_color)} strokeWidth={2.2} />
                </span>
                <div className="relative">
                  <p className="text-base font-bold leading-tight" style={{ ...FONT_DISPLAY, color: readableTextColor(m.brand_color) }}>
                    {m.store_name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] opacity-75" style={{ color: readableTextColor(m.brand_color) }}>
                    {m.category}
                  </p>
                  <p className="mt-2 text-[11px] font-semibold opacity-90" style={{ color: readableTextColor(m.brand_color) }}>
                    {count ? `${count} produtos` : "Ver produtos"} →
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ============================================================
  // Tela: dentro de um módulo
  // ============================================================
  function ModuleCatalogScreen() {
    const m = allModules.find((x) => x.store_id === activeModuleId);
    if (!m) return null;
    const catalog = catalogs[m.store_id];
    const storeCartCount = (cartByStore.get(m.store_id) ?? []).reduce((s, l) => s + l.quantity, 0);
    const categories = catalog?.loaded ? groupProductsByCategory(catalog.products) : [];
    const q = moduleSearch.trim().toLowerCase();
    const visibleCategories = categories
      .filter(([cat]) => !activeCategory || activeCategory === "Destaques" || cat === activeCategory)
      .map(([cat, products]) => [cat, q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products] as [string, Product[]])
      .filter(([, products]) => products.length > 0);

    return (
      <div className={cartCount > 0 ? "flex flex-1 flex-col pb-40" : "flex flex-1 flex-col pb-24"}>
        <div
          className="px-4 pb-4 pt-4 text-white transition-colors duration-300 sm:px-6"
          style={{ backgroundColor: m.brand_color, color: readableTextColor(m.brand_color) }}
        >
          <div className="flex items-center gap-3">
            <button onClick={() => setView("modulos")} className="rounded-full p-1 opacity-90 active:scale-90">
              <ChevronLeft size={22} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold">{m.store_name}</p>
              <p className="truncate text-xs opacity-80">{m.category}</p>
            </div>
            <button onClick={goToCart} className="relative rounded-full p-1.5 opacity-90 active:scale-90">
              <ShoppingCart size={20} />
              {storeCartCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold" style={{ color: m.brand_color }}>
                  {storeCartCount}
                </span>
              )}
            </button>
          </div>

          <div className="relative mt-3">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={moduleSearch}
              onChange={(e) => setModuleSearch(e.target.value)}
              placeholder={`Buscar em ${m.store_name.toLowerCase()}…`}
              className="w-full rounded-xl border-0 bg-white/95 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        {categories.length > 0 && (
          <div className="flex gap-4 overflow-x-auto border-b border-slate-100 bg-white px-4 pt-2 sm:px-6">
            {["Destaques", ...categories.map(([c]) => c)].map((cat) => {
              const isActive = activeCategory === cat || (!activeCategory && cat === "Destaques");
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className="shrink-0 whitespace-nowrap pb-2.5 text-sm font-medium transition"
                  style={{
                    color: isActive ? m.brand_color : "#94a3b8",
                    borderBottom: isActive ? `2px solid ${m.brand_color}` : "2px solid transparent",
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 bg-white px-4 pt-4 sm:px-6">
          {catalog?.loading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-slate-100">
                  <div className="animate-mm-shimmer absolute inset-0" />
                </div>
              ))}
            </div>
          )}
          {catalog?.error && <p className="py-2 text-sm text-red-600">{catalog.error}</p>}
          {catalog?.loaded && catalog.products.length === 0 && <p className="py-2 text-sm text-slate-500">Essa loja ainda não cadastrou produtos.</p>}
          {catalog?.loaded &&
            visibleCategories.map(([category, products], i) => (
              <div key={category} className={i > 0 ? "mt-5" : ""}>
                {(!activeCategory || activeCategory === "Destaques") && (
                  <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-slate-400">{category}</h3>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {products.map((product, pi) => {
                    const key = cartKey(m.store_id, product.id);
                    const quantity = cart[key] ?? 0;
                    const price = effectivePrice(product);
                    const onOffer = isOfferActive(product);
                    return (
                      <div
                        key={product.id}
                        className="animate-mm-fade-up group flex flex-col overflow-hidden rounded-2xl border border-slate-100 shadow-md transition duration-300 hover:-translate-y-1 hover:shadow-2xl"
                        style={{ animationDelay: `${pi * 50}ms`, boxShadow: `0 12px 26px -16px ${m.brand_color}80` }}
                      >
                        <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
                          {product.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.image_url} alt={product.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-110" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-slate-300">
                              <Package size={28} />
                            </div>
                          )}
                          <div className="absolute left-1.5 top-1.5 flex flex-col gap-1">
                            {onOffer && (
                              <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Oferta</span>
                            )}
                            {isNewProduct(product.created_at) && (
                              <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Novo</span>
                            )}
                          </div>
                          {product.stock <= 0 && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
                              <span className="rounded-full bg-slate-900/90 px-2 py-0.5 text-[10px] font-semibold text-white">Sem estoque</span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col p-2.5">
                          <p className="line-clamp-2 min-h-[2.3em] text-xs font-medium leading-tight text-slate-900">{product.name}</p>
                          {onOffer ? (
                            <p className="mt-1 flex items-baseline gap-1">
                              <span className="text-sm font-bold text-red-600">{formatCurrency(price)}</span>
                              <span className="text-[10px] text-slate-400 line-through">{formatCurrency(product.price)}</span>
                            </p>
                          ) : (
                            <p className="mt-1 text-sm font-bold" style={{ color: m.brand_color }}>
                              {formatCurrency(price)}
                            </p>
                          )}
                          <div className="mt-auto pt-2">
                            {quantity === 0 ? (
                              <button
                                onClick={() => setQuantity(m.store_id, product.id, 1)}
                                disabled={product.stock <= 0}
                                style={{ backgroundColor: m.accent_color, color: readableTextColor(m.accent_color) }}
                                className="w-full rounded-full px-2 py-1.5 text-xs font-semibold shadow-md transition active:scale-90 disabled:opacity-40"
                              >
                                {product.stock <= 0 ? "Sem estoque" : "Adicionar"}
                              </button>
                            ) : (
                              <div className="animate-mm-scale-in flex w-full items-center justify-between rounded-full bg-slate-100 px-1 py-1">
                                <button onClick={() => setQuantity(m.store_id, product.id, quantity - 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition active:scale-75">
                                  <Minus size={12} />
                                </button>
                                <span key={quantity} className="animate-mm-scale-in text-xs font-semibold text-slate-900">
                                  {quantity}
                                </span>
                                <button
                                  onClick={() => setQuantity(m.store_id, product.id, Math.min(quantity + 1, product.stock))}
                                  disabled={quantity >= product.stock}
                                  className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition active:scale-75 disabled:opacity-40"
                                >
                                  <Plus size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>

        <FloatingCartBar />
      </div>
    );
  }

  // ============================================================
  // Tela: Carrinho
  // ============================================================
  function CartScreen() {
    return (
      <div className="flex flex-1 flex-col pb-24">
        <div className="flex items-center gap-3 px-4 pb-4 pt-5 sm:px-6" style={{ backgroundColor: PLATFORM_SURFACE }}>
          <button onClick={() => setView("inicio")} className="rounded-full p-1 text-white/80 active:scale-90">
            <ChevronLeft size={22} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-white" style={FONT_DISPLAY}>
              Meu carrinho
            </h1>
            <p className="text-xs text-white/60">
              {storesInCart.length} {storesInCart.length === 1 ? "loja" : "lojas"}
            </p>
          </div>
        </div>

        {cartItems.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <ShoppingCart size={32} className="text-white/30" />
            <p className="text-sm text-white/60">Seu carrinho está vazio.</p>
            <button onClick={() => setView("inicio")} className="mt-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white">
              Ver produtos
            </button>
          </div>
        ) : (
          <div className="space-y-3 px-4 pt-4 sm:px-6">
            {storesInCart.map((m, mi) => {
              const lines = cartByStore.get(m.store_id) ?? [];
              const storeSubtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
              return (
                <div
                  key={m.store_id}
                  className="animate-mm-fade-up rounded-2xl bg-white p-4 shadow-lg"
                  style={{ animationDelay: `${mi * 80}ms`, boxShadow: `0 10px 24px -14px ${m.brand_color}99` }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: m.brand_color, color: readableTextColor(m.brand_color) }}
                    >
                      {storeInitials(m.store_name)}
                    </span>
                    <p className="text-sm font-bold text-slate-900">{m.store_name}</p>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {lines.map((l) => (
                      <div key={l.key} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-700">{l.name}</p>
                          <p className="text-xs text-slate-400">{formatCurrency(l.price)} cada</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-1 py-1">
                            <button onClick={() => setQuantity(m.store_id, l.productId, l.quantity - 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm active:scale-90">
                              <Minus size={12} />
                            </button>
                            <span className="w-4 text-center text-xs font-semibold">{l.quantity}</span>
                            <button onClick={() => setQuantity(m.store_id, l.productId, l.quantity + 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm active:scale-90">
                              <Plus size={12} />
                            </button>
                          </div>
                          <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(l.lineTotal)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 flex justify-between border-t border-slate-100 pt-2.5 text-sm font-semibold text-slate-900">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatCurrency(storeSubtotal)}</span>
                  </p>
                </div>
              );
            })}

            <div className="rounded-2xl bg-white/10 p-4">
              <p className="flex justify-between text-base font-bold text-white">
                <span>Total geral</span>
                <span className="tabular-nums">{formatCurrency(subtotal)}</span>
              </p>
            </div>
          </div>
        )}

        {cartItems.length > 0 && (
          <div className="fixed inset-x-0 bottom-16 z-30 px-4 pb-3 sm:bottom-0 sm:left-60 sm:px-6 sm:pb-4">
            <button
              onClick={goToDelivery}
              className="mx-auto flex w-full max-w-2xl items-center justify-center rounded-2xl px-5 py-3.5 font-semibold shadow-xl shadow-black/30 active:scale-[0.99]"
              style={{ backgroundColor: PLATFORM_ACCENT, color: PLATFORM_ACCENT_TEXT, ...FONT_DISPLAY }}
            >
              Continuar — {formatCurrency(subtotal)}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // Tela: Entrega
  // ============================================================
  function DeliveryScreen() {
    return (
      <div className="flex flex-1 flex-col pb-24">
        <div className="flex items-center gap-3 px-4 pb-4 pt-5 sm:px-6" style={{ backgroundColor: PLATFORM_SURFACE }}>
          <button onClick={() => setView("carrinho")} className="rounded-full p-1 text-white/80 active:scale-90">
            <ChevronLeft size={22} />
          </button>
          <h1 className="text-lg font-bold text-white" style={FONT_DISPLAY}>
            Entrega
          </h1>
        </div>

        <div className="space-y-3 px-4 pt-4 sm:px-6">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Seu nome</label>
            <input
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
            <label className="mt-3.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp</label>
            <input
              required
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="(11) 91234-5678"
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resumo do pedido · {storesInCart.length} {storesInCart.length === 1 ? "loja" : "lojas"}</p>
            <div className="mt-2 space-y-1.5 text-sm">
              {storesInCart.map((m) => {
                const storeSubtotal = (cartByStore.get(m.store_id) ?? []).reduce((s, l) => s + l.lineTotal, 0);
                return (
                  <p key={m.store_id} className="flex justify-between text-slate-600">
                    <span>{m.store_name}</span>
                    <span className="tabular-nums">{formatCurrency(storeSubtotal)}</span>
                  </p>
                );
              })}
              {deliveryFeeTotal > 0 && (
                <p className="flex justify-between text-slate-600">
                  <span>Taxa de entrega</span>
                  <span className="tabular-nums">{formatCurrency(deliveryFeeTotal)}</span>
                </p>
              )}
            </div>
            <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-bold text-slate-900">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(totalGeral)}</span>
            </p>
          </div>

          {storesInCart.map((m) => {
            const choice = deliveryByStore[m.store_id] ?? { neighborhoodId: "retirada", address: "" };
            const neighborhoods = catalogs[m.store_id]?.neighborhoods ?? [];
            if (neighborhoods.length === 0) {
              return (
                <div key={m.store_id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <p className="text-sm font-bold text-slate-900">{m.store_name}</p>
                  <p className="mt-1 text-xs text-slate-400">Combine a entrega dessa loja direto com ela.</p>
                </div>
              );
            }
            return (
              <div key={m.store_id} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-900">{m.store_name}</p>
                <p className="mt-0.5 text-xs text-slate-400">Como deseja receber?</p>
                <div className="mt-2 space-y-2">
                  <label
                    className="flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition"
                    style={
                      choice.neighborhoodId === "retirada"
                        ? { borderColor: PLATFORM_ACCENT, backgroundColor: "#FFF8EB" }
                        : { borderColor: "#e2e8f0" }
                    }
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={choice.neighborhoodId === "retirada"}
                        onChange={() => setDeliveryByStore((prev) => ({ ...prev, [m.store_id]: { neighborhoodId: "retirada", address: prev[m.store_id]?.address ?? "" } }))}
                      />
                      Retirar no local
                    </span>
                  </label>
                  {neighborhoods.map((n) => (
                    <label
                      key={n.id}
                      className="flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition"
                      style={
                        choice.neighborhoodId === n.id
                          ? { borderColor: PLATFORM_ACCENT, backgroundColor: "#FFF8EB" }
                          : { borderColor: "#e2e8f0" }
                      }
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={choice.neighborhoodId === n.id}
                          onChange={() => setDeliveryByStore((prev) => ({ ...prev, [m.store_id]: { neighborhoodId: n.id, address: prev[m.store_id]?.address ?? "" } }))}
                        />
                        Entrega — {n.name}
                      </span>
                      <span className="font-semibold tabular-nums text-slate-700">{formatCurrency(n.fee)}</span>
                    </label>
                  ))}
                  {choice.neighborhoodId !== "retirada" && (
                    <input
                      required
                      value={choice.address}
                      onChange={(e) => setDeliveryByStore((prev) => ({ ...prev, [m.store_id]: { ...choice, address: e.target.value } }))}
                      placeholder="Endereço completo de entrega"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                    />
                  )}
                  {choice.neighborhoodId !== "retirada" &&
                    catalogs[m.store_id]?.minOrderEnabled &&
                    (() => {
                      const storeSubtotal = (cartByStore.get(m.store_id) ?? []).reduce((s, l) => s + l.lineTotal, 0);
                      const minValue = catalogs[m.store_id]?.minOrderValue ?? 0;
                      if (storeSubtotal >= minValue) return null;
                      return (
                        <p className="text-xs font-medium text-amber-700">
                          Pedido mínimo pra entrega nessa loja é {formatCurrency(minValue)} — faltam {formatCurrency(minValue - storeSubtotal)}
                        </p>
                      );
                    })()}
                  {choice.neighborhoodId !== "retirada" &&
                    catalogs[m.store_id]?.freeDeliveryEnabled &&
                    (() => {
                      const storeSubtotal = (cartByStore.get(m.store_id) ?? []).reduce((s, l) => s + l.lineTotal, 0);
                      const threshold = catalogs[m.store_id]?.freeDeliveryThreshold ?? 0;
                      if (threshold <= 0) return null;
                      if (storeSubtotal >= threshold) {
                        return <p className="text-xs font-medium text-green-700">🎉 Frete grátis nessa loja!</p>;
                      }
                      return (
                        <p className="text-xs text-slate-400">
                          Faltam {formatCurrency(threshold - storeSubtotal)} pro frete grátis nessa loja
                        </p>
                      );
                    })()}
                </div>
              </div>
            );
          })}
        </div>

        <div className="fixed inset-x-0 bottom-16 z-30 px-4 pb-3 sm:bottom-0 sm:left-60 sm:px-6 sm:pb-4">
          <button
            onClick={() => setView("pagamento")}
            className="mx-auto flex w-full max-w-2xl items-center justify-center rounded-2xl px-5 py-3.5 font-semibold shadow-xl shadow-black/30 active:scale-[0.99]"
            style={{ backgroundColor: PLATFORM_ACCENT, color: PLATFORM_ACCENT_TEXT, ...FONT_DISPLAY }}
          >
            Continuar para pagamento
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // Tela: Pagamento
  // ============================================================
  function PaymentScreen() {
    return (
      <div className="flex flex-1 flex-col pb-24">
        <div className="flex items-center gap-3 px-4 pb-4 pt-5 sm:px-6" style={{ backgroundColor: PLATFORM_SURFACE }}>
          <button onClick={() => setView("entrega")} className="rounded-full p-1 text-white/80 active:scale-90">
            <ChevronLeft size={22} />
          </button>
          <h1 className="text-lg font-bold text-white" style={FONT_DISPLAY}>
            Pagamento
          </h1>
        </div>

        <form onSubmit={handleCheckout} className="space-y-3 px-4 pt-4 sm:px-6">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Forma de pagamento</p>
            <div className="mt-2.5 space-y-2">
              {(["dinheiro", "cartao_entrega", "pix", "cartao"] as const).map((pm) => (
                <label
                  key={pm}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm transition ${
                    paymentMethod === pm ? "font-semibold text-slate-900" : "border-slate-200 text-slate-600"
                  }`}
                  style={paymentMethod === pm ? { borderColor: PLATFORM_ACCENT, backgroundColor: "#FFF8EB" } : undefined}
                >
                  <input type="radio" name="paymentMethod" checked={paymentMethod === pm} onChange={() => setPaymentMethod(pm)} />
                  {pm === "dinheiro"
                    ? "Dinheiro na entrega"
                    : pm === "cartao_entrega"
                      ? "Cartão na entrega (maquininha)"
                      : pm === "pix"
                        ? "Pix"
                        : "Cartão de crédito"}
                </label>
              ))}
            </div>
            {(paymentMethod === "pix" || paymentMethod === "cartao") && (
              <input
                required
                value={customerCpf}
                onChange={(e) => setCustomerCpf(e.target.value)}
                placeholder="Seu CPF"
                className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            )}
            {paymentMethod === "cartao" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input required value={cardHolder} onChange={(e) => setCardHolder(e.target.value)} placeholder="Nome no cartão" className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
                <input required value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="Número do cartão" className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
                <input required value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="MM/AA" className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
                <input required value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} placeholder="CVV" className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
                <select
                  value={cardInstallments}
                  onChange={(e) => setCardInstallments(Number(e.target.value))}
                  className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                >
                  {[1, 2, 3].map((n) => {
                    const withInterest =
                      n > 1 && hubStore.card_installment_interest_enabled && hubStore.card_installment_interest_percent > 0
                        ? totalGeral * (1 + (hubStore.card_installment_interest_percent / 100) * (n - 1))
                        : totalGeral;
                    return (
                      <option key={n} value={n}>
                        {n}x de {formatCurrency(withInterest / n)}
                        {n === 1 ? " (à vista)" : withInterest > totalGeral ? " com juros" : " sem juros"}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white/10 p-4">
            <p className="flex justify-between text-sm text-white/80">
              <span>Produtos</span>
              <span className="tabular-nums">{formatCurrency(subtotal)}</span>
            </p>
            {deliveryFeeTotal > 0 && (
              <p className="mt-1 flex justify-between text-sm text-white/80">
                <span>Entrega</span>
                <span className="tabular-nums">{formatCurrency(deliveryFeeTotal)}</span>
              </p>
            )}
            <p className="mt-2 flex justify-between border-t border-white/20 pt-2 text-lg font-bold tabular-nums text-white">
              <span>Total</span>
              <span>{formatCurrency(totalGeral)}</span>
            </p>
          </div>

          {error && <p className="text-sm font-medium text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-2xl px-4 py-3.5 font-semibold shadow-xl shadow-black/30 transition active:scale-[0.99] disabled:opacity-60"
            style={{ backgroundColor: PLATFORM_ACCENT, color: PLATFORM_ACCENT_TEXT, ...FONT_DISPLAY }}
          >
            {saving ? "Enviando…" : `Finalizar pedido — ${formatCurrency(totalGeral)}`}
          </button>

          <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-xs text-white/35">
            <ShieldCheck size={14} /> Seus dados ficam só entre você e as lojas do pedido
          </p>
        </form>
      </div>
    );
  }

  // ============================================================
  // Tela: Confirmação
  // ============================================================
  function ConfirmationScreen() {
    const receiptTotal = receipt?.reduce((s, r) => s + r.store_total, 0) ?? totalGeral;
    return (
      <div className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md">
          <div className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold shadow-lg" style={{ backgroundColor: PLATFORM_ACCENT, color: PLATFORM_ACCENT_TEXT }}>
            ✓
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-white" style={FONT_DISPLAY}>
            Pedido enviado!
          </h1>
          <p className="mt-1.5 text-sm text-white/70">
            {receipt && receipt.length > 1 ? `Seu pedido foi dividido em ${receipt.length} lojas — cada uma vai preparar a parte dela.` : "Seu pedido foi enviado."}
          </p>

          <div className="mt-6 space-y-3">
            {(receipt ?? []).map((r) => (
              <div key={r.order_id} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: r.store_brand_color, color: readableTextColor(r.store_brand_color) }}>
                    {storeInitials(r.store_name)}
                  </span>
                  <p className="text-sm font-bold text-slate-900">{r.store_name}</p>
                </div>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                  {r.items.map((item, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate">{item.quantity}x {item.name}</span>
                      <span className="shrink-0 tabular-nums">{formatCurrency(item.line_total ?? item.price * item.quantity)}</span>
                    </li>
                  ))}
                </ul>
                {r.delivery_fee > 0 && (
                  <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm text-slate-500">
                    <span>Entrega</span>
                    <span className="tabular-nums">{formatCurrency(r.delivery_fee)}</span>
                  </p>
                )}
                <p className={`flex justify-between pt-2.5 text-sm font-semibold text-slate-900 ${r.delivery_fee > 0 ? "" : "mt-2.5 border-t border-slate-100"}`}>
                  <span>Total dessa loja</span>
                  <span className="tabular-nums">{formatCurrency(r.store_total)}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl bg-white/10 p-4 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-white/60">Total combinado</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-white">{formatCurrency(receiptTotal)}</p>
          </div>

          {paymentMethod === "pix" && (
            <div className="mt-4 rounded-2xl bg-white p-4 text-center shadow-sm">
              {pixLoading && <p className="text-sm text-slate-500">Gerando o Pix…</p>}
              {pixError && <p className="text-sm text-red-600">{pixError}</p>}
              {pixQrCodeImage && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pixQrCodeImage} alt="QR Code Pix" className="mx-auto h-48 w-48" />
                  <p className="mt-2 text-xs text-slate-500">Escaneie com o app do seu banco pra pagar.</p>
                  {pixQrCodeText && (
                    <button
                      onClick={() => navigator.clipboard.writeText(pixQrCodeText)}
                      className="mt-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold"
                      style={{ backgroundColor: PLATFORM_ACCENT, color: PLATFORM_ACCENT_TEXT }}
                    >
                      Copiar código Pix
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {paymentMethod === "cartao" && (
            <div className="mt-4 rounded-2xl bg-white p-4 text-center shadow-sm">
              {cardLoading && <p className="text-sm text-slate-500">Processando o cartão…</p>}
              {cardError && <p className="text-sm text-red-600">{cardError}</p>}
              {cardPaid && <p className="text-sm font-semibold text-green-600">✓ Pagamento aprovado!</p>}
            </div>
          )}

          {confirmedHubOrderId && (
            <a href={`/loja/${hubStore.slug}/pedido-hub/${confirmedHubOrderId}`} className="mt-6 block w-full rounded-full border border-white/25 px-4 py-3 text-center text-sm font-semibold text-white">
              Ver recibo completo
            </a>
          )}
          <button
            onClick={() => setView("inicio")}
            className="mt-3 block w-full rounded-full px-4 py-3 text-center font-semibold shadow-sm"
            style={{ backgroundColor: PLATFORM_ACCENT, color: PLATFORM_ACCENT_TEXT, ...FONT_DISPLAY }}
          >
            Voltar à loja
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // Tela: Conta
  // ============================================================
  function AccountScreen() {
    const whatsappUrl = hubStore.whatsapp ? `https://wa.me/55${hubStore.whatsapp.replace(/\D/g, "")}` : null;
    const totalCashback = hubCustomerSummary.reduce((s, c) => s + c.cashback_balance, 0);

    // Um pedido do Hub sempre tem hub_order_id (checkout_hub cria isso
    // pra qualquer carrinho, mesmo de 1 loja só) — agrupa as pernas por
    // pedido combinado pra mostrar um card só, não um por loja.
    const ordersByHub = new Map<string, typeof hubOrders>();
    for (const o of hubOrders) {
      if (!ordersByHub.has(o.hub_order_id)) ordersByHub.set(o.hub_order_id, []);
      ordersByHub.get(o.hub_order_id)!.push(o);
    }

    return (
      <div className="flex flex-1 flex-col pb-24">
        <div className="px-4 pb-4 pt-5 sm:px-6" style={{ backgroundColor: PLATFORM_SURFACE }}>
          <h1 className="text-lg font-bold text-white" style={FONT_DISPLAY}>
            {customerLoggedIn ? `Olá, ${customerAccountName ?? "cliente"}` : "Conta"}
          </h1>
        </div>
        <div className="space-y-2 px-4 pt-4 sm:px-6">
          {!customerLoggedIn && (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-600">Entra na sua conta pra ver cashback, indicação e o histórico de pedidos.</p>
              <div className="mt-3 flex gap-2">
                <a
                  href={`/cliente/entrar?loja=${hubStore.slug}`}
                  className="flex-1 rounded-xl px-3 py-2.5 text-center text-sm font-semibold"
                  style={{ backgroundColor: PLATFORM_ACCENT, color: PLATFORM_ACCENT_TEXT }}
                >
                  Entrar
                </a>
                <a
                  href={`/cliente/cadastro?loja=${hubStore.slug}`}
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-center text-sm font-semibold text-slate-700"
                >
                  Criar conta
                </a>
              </div>
            </div>
          )}

          {customerLoggedIn && (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cashback total no Hub</p>
              <p className="mt-0.5 text-xl font-bold text-green-700">{formatCurrency(totalCashback)}</p>
              {loadingAccountData ? (
                <p className="mt-2 text-xs text-slate-400">Carregando saldo por loja…</p>
              ) : (
                hubCustomerSummary.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                    {hubCustomerSummary.map((c) => (
                      <div key={c.store_id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.brand_color }} />
                          {c.store_name}
                        </span>
                        <span className="flex items-center gap-2 text-slate-500">
                          {formatCurrency(c.cashback_balance)} cashback
                          {c.referral_code && (
                            <button
                              type="button"
                              onClick={() =>
                                navigator.clipboard.writeText(`${window.location.origin}/loja/${hubStore.slug}?ref=${c.referral_code}`)
                              }
                              title={`Copiar link de indicação de ${c.store_name}`}
                              className="underline"
                            >
                              indicar
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}

          {customerLoggedIn && (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Histórico de pedidos</p>
              {loadingAccountData ? (
                <p className="mt-2 text-sm text-slate-400">Carregando…</p>
              ) : ordersByHub.size === 0 ? (
                <p className="mt-2 text-sm text-slate-400">Você ainda não fez nenhum pedido no Hub.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {[...ordersByHub.entries()].map(([hubOrderId, legs]) => {
                    const total = legs.reduce((s, l) => s + l.total, 0);
                    const cashback = legs.reduce((s, l) => s + l.cashback_earned, 0);
                    const createdAt = legs[0].created_at;
                    const status = legs.every((l) => l.status === "entregue")
                      ? "entregue"
                      : legs.some((l) => l.status === "cancelado") && legs.every((l) => l.status === "cancelado")
                        ? "cancelado"
                        : legs.some((l) => l.status === "entregando")
                          ? "entregando"
                          : legs[0].status;
                    return (
                      <li key={hubOrderId} className="rounded-xl border border-slate-200 p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">
                              {new Date(createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {legs.map((l) => l.store_name).join(" + ")}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-semibold text-slate-900">{formatCurrency(total)}</p>
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                status === "cancelado"
                                  ? "bg-red-100 text-red-700"
                                  : status === "entregue"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {ACCOUNT_ORDER_STATUS_LABELS[status] ?? status}
                            </span>
                          </div>
                        </div>
                        {cashback > 0 && <p className="mt-1 text-xs text-green-700">+ {formatCurrency(cashback)} de cashback</p>}
                        <a href={`/loja/${hubStore.slug}/pedido-hub/${hubOrderId}`} className="mt-1 inline-block text-xs font-medium underline" style={{ color: PLATFORM_ACCENT }}>
                          Ver recibo
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {!customerLoggedIn && lastOrderId && (
            <a href={`/loja/${hubStore.slug}/pedido-hub/${lastOrderId}`} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
              <Package size={18} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-700">Meu último pedido</span>
              <ChevronRight size={16} className="ml-auto text-slate-300" />
            </a>
          )}
          {whatsappUrl && (
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
              <MessageCircle size={18} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-700">Falar no WhatsApp</span>
              <ChevronRight size={16} className="ml-auto text-slate-300" />
            </a>
          )}
          <a href="/privacidade" className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
            <span className="text-sm font-medium text-slate-700">Aviso de privacidade</span>
            <ChevronRight size={16} className="ml-auto text-slate-300" />
          </a>
          <a href="/termos" className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
            <span className="text-sm font-medium text-slate-700">Termo de uso</span>
            <ChevronRight size={16} className="ml-auto text-slate-300" />
          </a>
          {customerLoggedIn && (
            <button
              type="button"
              onClick={handleCustomerSignOut}
              className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm"
            >
              <span className="text-sm font-medium text-red-600">Sair da conta</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const screens: Record<View, () => React.ReactNode> = {
    inicio: HomeScreen,
    modulos: ModulePickerScreen,
    modulo: ModuleCatalogScreen,
    carrinho: CartScreen,
    entrega: DeliveryScreen,
    pagamento: PaymentScreen,
    confirmado: ConfirmationScreen,
    conta: AccountScreen,
  };
  // Chamada como função (não `<Screens[view] />`) de propósito: como essas
  // funções são recriadas a cada render, usá-las como tipo de componente JSX
  // faria o React desmontar e remontar a tela inteira a cada clique (até um
  // +1 de quantidade recarregaria a tela, perdendo scroll e recarregando
  // imagem). Chamando como função só o retorno (a árvore de elementos) é
  // reconciliado normalmente. A troca de tela de verdade (para a transição)
  // é sinalizada só pela `key` abaixo, amarrada à view + módulo ativo.
  const viewKey = view === "modulo" ? `modulo-${activeModuleId}` : view;

  return (
    <div className="flex flex-1" style={{ backgroundColor: PLATFORM_BG, ...FONT_BODY }}>
      <DesktopSidebar />
      <div className="flex flex-1 flex-col">
        <div key={viewKey} className="animate-mm-fade-up mx-auto flex w-full max-w-5xl flex-1 flex-col">
          {screens[view]()}
        </div>
        <BottomNav />
      </div>
    </div>
  );
}
