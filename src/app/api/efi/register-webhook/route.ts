import "server-only";
import { registerEfiWebhook } from "@/lib/efi-pix";

// Roda só uma vez (ou de novo se a URL do site mudar) — registra na Efí
// pra onde ela deve mandar aviso quando um Pix é pago. Protegido por uma
// senha simples via query string (?key=...) só pra evitar chamada por
// engano de qualquer um que ache a URL — não é dado sensível de verdade,
// só evita reconfigurar à toa.
export async function POST(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!process.env.EFI_SETUP_KEY || key !== process.env.EFI_SETUP_KEY) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    await registerEfiWebhook("https://meu-mercado-blond.vercel.app/api/efi/webhook");
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Efí register-webhook failed:", err instanceof Error ? err.message : err, (err as { body?: unknown })?.body);
    return Response.json({ error: "Não deu pra registrar o webhook", details: (err as { body?: unknown })?.body }, { status: 502 });
  }
}
