import { ImageResponse } from "next/og";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);
  const size = Number(searchParams.get("size")) || 512;

  const supabase = getSupabase();
  const { data: store } = await supabase
    .from("stores")
    .select("name")
    .eq("slug", slug)
    .maybeSingle();

  const initials = (store?.name ?? "MM").trim().slice(0, 2).toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e3a8a",
          color: "#fcd34d",
          fontSize: size * 0.42,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        {initials}
      </div>
    ),
    { width: size, height: size },
  );
}
