import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// O PagBank chama essa rota sozinho quando o status de um pagamento muda
// (ex: Pix caiu). Confirmamos que a chamada é mesmo do PagBank calculando
// sha256(token + "-" + corpo-cru-da-requisição) e comparando com o cabeçalho
// x-authenticity-token — sem isso, qualquer um poderia forjar um aviso de
// "pago" pra um pedido que nunca foi pago de verdade.
export async function POST(request: Request) {
  const token = process.env.PAGBANK_TOKEN;
  if (!token) {
    return new Response("Pagamento Pix não configurado", { status: 500 });
  }

  const rawBody = await request.text();
  const receivedSignature = request.headers.get("x-authenticity-token") ?? "";
  const expectedSignature = createHash("sha256").update(`${token}-${rawBody}`).digest("hex");

  const a = Buffer.from(receivedSignature);
  const b = Buffer.from(expectedSignature);
  const validSignature = a.length === b.length && timingSafeEqual(a, b);
  if (!validSignature) {
    return new Response("Assinatura inválida", { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    reference_id?: string;
    charges?: { status?: string }[];
  };

  const orderId = payload.reference_id;
  const paid = payload.charges?.some((c) => c.status === "PAID");

  if (orderId && paid) {
    const supabase = getSupabaseAdmin();
    await supabase
      .from("orders")
      .update({ pix_paid_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("pix_paid_at", null);
  }

  return new Response("OK", { status: 200 });
}
