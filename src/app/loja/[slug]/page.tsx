import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import StorefrontClient from "./storefront-client";

export const dynamic = "force-dynamic";

export default async function Loja({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabase();

  const { data: store } = await supabase
    .from("stores")
    .select(
      "id, slug, name, whatsapp, cashback_percent, business_hours_enabled, opens_at, closes_at, open_days, manually_closed",
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
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, category, price, image_url, stock")
      .eq("store_id", store.id)
      .eq("active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("banners")
      .select("id, title, image_url, link_url")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("kits")
      .select("id, name, image_url, price, kit_items(quantity, products(name, stock))")
      .eq("store_id", store.id)
      .eq("active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("reviews")
      .select("id, product_id, customer_name, rating, comment, created_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("neighborhoods")
      .select("id, name, fee")
      .eq("store_id", store.id)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("store_reviews")
      .select("id, rating")
      .eq("store_id", store.id),
  ]);

  return (
    <StorefrontClient
      store={store}
      products={products ?? []}
      banners={banners ?? []}
      kits={(kits as unknown as import("./storefront-client").Kit[]) ?? []}
      reviews={reviews ?? []}
      neighborhoods={neighborhoods ?? []}
      storeReviews={storeReviews ?? []}
    />
  );
}
