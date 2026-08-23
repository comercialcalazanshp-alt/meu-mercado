// Tipos e funções de preço/formatação compartilhados entre a vitrine de loja
// única (storefront-client.tsx) e a vitrine em módulos do hub
// (hub-storefront-client.tsx) — extraído pra não duplicar essas regras (e
// arriscar as duas vitrines calcularem preço de jeitos diferentes).

export type Product = {
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
  offer_ends_at: string | null;
  created_at: string;
  barcode: string | null;
};

export type KitComponent = {
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

export type Banner = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  focal_x: number;
  focal_y: number;
  text_style: import("@/components/BannerOverlay").BannerTextStyle | null;
  overlay_text: string | null;
};

export type Neighborhood = {
  id: string;
  name: string;
  fee: number;
  eta_min_minutes: number | null;
  eta_max_minutes: number | null;
};

export type Store = {
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
  min_order_for_delivery_enabled: boolean;
  min_order_for_delivery: number;
  card_installment_interest_enabled: boolean;
  card_installment_interest_percent: number;
  free_delivery_threshold_enabled: boolean;
  free_delivery_threshold: number;
};

export function isNewProduct(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < 7 * 86400000;
}

// "Ofertas do dia" tem prazo opcional (offer_ends_at) — depois de vencido,
// o preço/selo de oferta some da vitrine sozinho, sem o dono precisar
// lembrar de desmarcar. checkout() já trata o mesmo prazo do lado do banco.
export function isOfferActive(product: Product) {
  return (
    product.on_offer &&
    product.offer_price !== null &&
    (!product.offer_ends_at || new Date(product.offer_ends_at) > new Date())
  );
}

export function effectivePrice(product: Product) {
  return isOfferActive(product) ? product.offer_price! : product.price;
}

export function lineTotalFor(
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

export function kitMaxQuantity(kit: Kit) {
  if (kit.kit_items.length === 0) return 0;
  return Math.min(
    ...kit.kit_items.map((item) => Math.floor((item.products?.stock ?? 0) / item.quantity)),
  );
}

export function kitSavings(kit: Kit) {
  const separateTotal = kit.kit_items.reduce((sum, item) => sum + item.quantity * (item.products?.price ?? 0), 0);
  return separateTotal - kit.price;
}

export function etaLabel(min: number | null, max: number | null): string | null {
  if (min && max) return min === max ? `${min} min` : `${min}-${max} min`;
  if (min) return `a partir de ${min} min`;
  if (max) return `até ${max} min`;
  return null;
}

export function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function readableTextColor(hex: string) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#fbbf24";
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.4 ? "#000000" : "#fbbf24";
}

export function storeInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// Escurece a cor da marca da loja pra usar como fundo da página — assim cada
// loja ganha um fundo escuro "premium" derivado da própria cor dela, em vez
// de uma cor fixa que não combinaria com lojas de cores diferentes.
export function darkenHex(hex: string, amount: number) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function isStoreOpenNow(store: Store): { open: boolean; message: string | null } {
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

export function groupProductsByCategory(products: Product[]): [string, Product[]][] {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const key = product.category || "Outros";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(product);
  }
  return Array.from(groups.entries());
}

// Só chamado uma vez, na primeira visita da sessão — de onde a pessoa
// veio pra cá. utm_source (link de campanha) manda mais que o referrer
// do navegador; sem isso, olha o referrer pra reconhecer as origens mais
// comuns de loja de bairro (WhatsApp, Instagram, Facebook, Google).
export function detectVisitSource(): string {
  if (typeof window === "undefined") return "direto";
  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get("utm_source");
  if (utmSource) return utmSource.toLowerCase().slice(0, 40);

  const ref = document.referrer;
  if (!ref) return "direto";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    if (host === window.location.hostname) return "direto";
    if (host.includes("wa.me") || host.includes("whatsapp")) return "whatsapp";
    if (host.includes("instagram")) return "instagram";
    if (host.includes("facebook") || host.includes("fb.com")) return "facebook";
    if (host.includes("google")) return "google";
    return host;
  } catch {
    return "direto";
  }
}

export type PagSeguroSdk = {
  encryptCard: (params: {
    publicKey: string;
    holder: string;
    number: string;
    expMonth: string;
    expYear: string;
    securityCode: string;
  }) => { encryptedCard: string | null; hasErrors: boolean; errors?: unknown[] };
};

let pagSeguroSdkPromise: Promise<void> | null = null;
export function loadPagSeguroSdk(): Promise<void> {
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
