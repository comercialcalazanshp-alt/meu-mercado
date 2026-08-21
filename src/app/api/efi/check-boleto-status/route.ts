import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getEfiChargeStatus } from "@/lib/efi-cobrancas";

// A Efí não tem um webhook documentado com clareza suficiente pra
// Cobranças (diferente do Pix) — em vez de arriscar confiar num aviso mal
// verificado, a confirmação do boleto é sob demanda: reconsulta a cobrança
// direto na API antes de marcar como pago.
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { table, record_id } = (await request.json()) as {
    table?: "affiliate_subscription_payments" | "affiliate_ai_purchases";
    record_id?: string;
  };
  if (table !== "affiliate_subscription_payments" && table !== "affiliate_ai_purchases") {
    return Response.json({ error: "table inválida" }, { status: 400 });
  }
  if (!record_id) {
    return Response.json({ error: "record_id é obrigatório" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: record } = await scoped.from(table).select("id, partnership_id, paid_at, pagbank_order_id").eq("id", record_id).maybeSingle();
  if (!record) {
    return Response.json({ error: "Cobrança não encontrada" }, { status: 404 });
  }
  if (record.paid_at) {
    return Response.json({ paid: true });
  }
  if (!record.pagbank_order_id) {
    return Response.json({ error: "Essa cobrança não tem boleto gerado" }, { status: 400 });
  }

  try {
    const status = await getEfiChargeStatus(Number(record.pagbank_order_id));
    if (status !== "paid") {
      return Response.json({ paid: false, status });
    }
  } catch (err) {
    console.error("Efí check-boleto-status failed:", err instanceof Error ? err.message : err, (err as { body?: unknown })?.body);
    return Response.json({ error: "Não deu pra consultar o boleto" }, { status: 502 });
  }

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();

  if (table === "affiliate_subscription_payments") {
    const { data: payment } = await admin.from(table).select("billing_cycle").eq("id", record_id).single();
    await admin.from(table).update({ paid_at: now }).eq("id", record_id);

    const cycleDays: Record<string, number> = { mensal: 30, trimestral: 90, semestral: 180, anual: 365 };
    const { data: partnership } = await admin.from("affiliate_partnerships").select("subscription_due_at").eq("id", record.partnership_id).single();
    const base =
      partnership?.subscription_due_at && new Date(partnership.subscription_due_at) > new Date()
        ? new Date(partnership.subscription_due_at)
        : new Date();
    base.setDate(base.getDate() + (cycleDays[payment?.billing_cycle ?? "mensal"] ?? 30));
    await admin.from("affiliate_partnerships").update({ subscription_due_at: base.toISOString() }).eq("id", record.partnership_id);
  } else {
    await admin.from(table).update({ paid_at: now }).eq("id", record_id);
  }

  return Response.json({ paid: true });
}
