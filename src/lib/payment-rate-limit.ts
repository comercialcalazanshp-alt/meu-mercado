import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const WINDOW_MINUTES = 10;
const MAX_ATTEMPTS_PER_WINDOW = 8;

// Endpoint de pagamento é público (checkout de convidado, sem login) — sem
// isso, alguém cria pedido em massa (barato, sem autenticação) e usa a
// cobrança de cartão como testador de cartão roubado em série, ou hammereia
// a geração de Pix. A trava por pedido (card_paid_at/claim_card_charge) só
// impede repetir NO MESMO pedido; isso aqui limita por IP, através de
// qualquer pedido.
export async function checkPaymentRateLimit(identifier: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const now = new Date();

  const { data: row } = await admin
    .from("payment_attempt_throttle")
    .select("window_start, attempt_count")
    .eq("identifier", identifier)
    .maybeSingle();

  const windowExpired = !row || now.getTime() - new Date(row.window_start).getTime() > WINDOW_MINUTES * 60_000;

  if (windowExpired) {
    await admin
      .from("payment_attempt_throttle")
      .upsert({ identifier, window_start: now.toISOString(), attempt_count: 1 });
    return true;
  }

  if (row.attempt_count >= MAX_ATTEMPTS_PER_WINDOW) {
    return false;
  }

  await admin
    .from("payment_attempt_throttle")
    .update({ attempt_count: row.attempt_count + 1 })
    .eq("identifier", identifier);
  return true;
}

export function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "sem-ip";
}
