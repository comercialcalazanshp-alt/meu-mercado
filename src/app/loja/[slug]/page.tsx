import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import StorefrontClient from "./storefront-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data: store } = await getSupabase()
    .from("stores")
    .select("name")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (!store) return {};

  return {
    title: store.name,
    manifest: `/loja/${slug}/manifest.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: "default", title: store.name },
    icons: { apple: `/loja/${slug}/icon?size=180` },
  };
}

export async function generateViewport({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Viewport> {
  const { slug } = await params;
  const { data: store } = await getSupabase()
    .from("stores")
    .select("brand_color")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  return { themeColor: store?.brand_color || "#1e3a8a" };
}

export default async function Loja({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabase();

  const { data: store } = await supabase
    .from("stores")
    .select(
      "id, slug, name, whatsapp, cashback_percent, business_hours_enabled, opens_at, closes_at, open_days, manually_closed, scratch_enabled, brand_color, accent_color",
    )
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (!store) notFound();

  const [
    { data: products },
    { data: banners },
    { data: kits },
    { data: reviews },
    { data: neighborhoods },
    { data: storeReviews },
    { data: recipeRows },
  ] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, category, price, image_url, stock, promo_buy_qty, promo_pay_qty, price_wholesale, wholesale_min_qty, on_offer, offer_price, offer_ends_at, created_at, barcode",
      )
      .eq("store_id", store.id)
      .eq("active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("banners")
      .select("id, title, image_url, link_url, focal_x, focal_y, text_style, overlay_text")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("kits")
      .select("id, name, image_url, price, starts_at, ends_at, kit_items(quantity, product_id, products(name, price, stock))")
      .eq("store_id", store.id)
      .eq("active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("reviews")
      .select("id, product_id, customer_name, rating, comment, created_at, owner_reply")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("neighborhoods")
      .select("id, name, fee, eta_min_minutes, eta_max_minutes")
      .eq("store_id", store.id)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("store_reviews")
      .select("id, rating")
      .eq("store_id", store.id),
    supabase
      .from("recipes")
      .select("id, name, description, instructions, image_url, ingredients")
      .eq("store_id", store.id)
      .eq("featured", true)
      .limit(1),
  ]);

  const now = Date.now();
  const activeKits = (kits ?? []).filter((k) => {
    const startsOk = !k.starts_at || new Date(k.starts_at).getTime() <= now;
    const endsOk = !k.ends_at || new Date(k.ends_at).getTime() >= now;
    return startsOk && endsOk;
  });

  return (
    <StorefrontClient
      store={store}
      products={products ?? []}
      banners={banners ?? []}
      kits={activeKits as unknown as import("./storefront-client").Kit[]}
      reviews={reviews ?? []}
      neighborhoods={neighborhoods ?? []}
      storeReviews={storeReviews ?? []}
      recipe={recipeRows?.[0] ?? null}
    />
  );
}
