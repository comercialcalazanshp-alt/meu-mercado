import { getSupabase } from "@/lib/supabase";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const supabase = getSupabase();
  const { data: store } = await supabase
    .from("stores")
    .select("name, slug")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (!store) {
    return new Response("Loja não encontrada", { status: 404 });
  }

  const manifest = {
    name: store.name,
    short_name: store.name.slice(0, 12),
    start_url: `/loja/${store.slug}`,
    scope: `/loja/${store.slug}`,
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1e3a8a",
    icons: [
      { src: `/loja/${store.slug}/icon?size=192`, sizes: "192x192", type: "image/png" },
      { src: `/loja/${store.slug}/icon?size=512`, sizes: "512x512", type: "image/png" },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
