import { ImageResponse } from "next/og";

// Ícone genérico do "app" do painel/PDV (não varia por loja, ao contrário do
// ícone da vitrine em /loja/[slug]/icon) — usado pelo manifest.ts pra deixar
// o painel instalável como PWA na tela do celular.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const size = Number(searchParams.get("size")) || 512;

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
        MM
      </div>
    ),
    { width: size, height: size },
  );
}
