import { ImageResponse } from "next/og";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function readableTextColor(hex: string) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#fcd34d";
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.45 ? "#1e293b" : "#fcd34d";
}

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
    .select("name, brand_color")
    .eq("slug", slug)
    .maybeSingle();

  const initials = (store?.name ?? "MM").trim().slice(0, 2).toUpperCase();
  const brandColor = store?.brand_color || "#1e3a8a";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: brandColor,
          color: readableTextColor(brandColor),
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
