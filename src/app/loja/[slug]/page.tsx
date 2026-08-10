import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import StorefrontClient from "./storefront-client";

export const dynamic = "force-dynamic";

export default async function Loja({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabase();

  const { data: store } = await supabase
    .from("stores")
    .select("id, slug, name, whatsapp")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (!store) notFound();

  const [{ data: products }, { data: banners }] = await Promise.all([
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
  ]);

  return <StorefrontClient store={store} products={products ?? []} banners={banners ?? []} />;
}
