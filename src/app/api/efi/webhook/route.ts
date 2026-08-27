import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getEfiPixChargeDetail } from "@/lib/efi-pix";
import { syncHubOrderPayment } from "@/lib/hub-order-payment-sync";

// A Efí chama essa rota quando um Pix muda de status, mas a notificação em
// si não vem assinada (diferente do PagBank, que manda um hash pra
// conferir). Por isso, em vez de confiar no corpo da chamada, reconsulta a
// cobrança direto na API da Efí (com nossas credenciais) antes de marcar
// qualquer coisa como paga — só uma resposta "CONCLUIDA" de lá é aceita.
export async function POST(request: Request) {
  let payload: { pix?: { txid?: string }[] };
  try {
    payload = await request.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  const txids = (payload.pix ?? []).map((p) => p.txid).filter((t): t is string => !!t);
  if (txids.length === 0) return new Response("OK", { status: 200 });

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  for (const txid of txids) {
    let detail: { status: string; pix: { endToEndId: string }[] };
    try {
      detail = await getEfiPixChargeDetail(txid);
    } catch (err) {
      console.error("Efí webhook: falha ao reconsultar txid", txid, err instanceof Error ? err.message : err);
      continue;
    }
    if (detail.status !== "CONCLUIDA") continue;
    const endToEndId = detail.pix?.[0]?.endToEndId ?? null;

    const { data: hubOrder } = await supabase
      .from("hub_orders")
      .select("id, pix_paid_at")
      .eq("pagbank_order_id", txid)
      .maybeSingle();
    if (hubOrder) {
      if (!hubOrder.pix_paid_at) {
        await supabase.from("hub_orders").update({ pix_paid_at: now, pix_end_to_end_id: endToEndId }).eq("id", hubOrder.id);
        await syncHubOrderPayment(supabase, hubOrder.id, "pix", undefined, endToEndId);
      }
      continue;
    }

    const { data: order } = await supabase.from("orders").select("id").eq("pagbank_order_id", txid).maybeSingle();
    if (order) {
      await supabase
        .from("orders")
        .update({ pix_paid_at: now, payment_method: "pix", pix_end_to_end_id: endToEndId })
        .eq("id", order.id)
        .is("pix_paid_at", null);
      await supabase.rpc("credit_pending_cashback", { p_order_id: order.id });
      continue;
    }

    const { data: subPayment } = await supabase
      .from("affiliate_subscription_payments")
      .select("id, partnership_id, billing_cycle, paid_at")
      .eq("pagbank_order_id", txid)
      .maybeSingle();
    if (subPayment) {
      if (!subPayment.paid_at) {
        await supabase.from("affiliate_subscription_payments").update({ paid_at: now }).eq("id", subPayment.id);
        const cycleDays: Record<string, number> = { mensal: 30, trimestral: 90, semestral: 180, anual: 365 };
        const { data: partnership } = await supabase
          .from("affiliate_partnerships")
          .select("subscription_due_at")
          .eq("id", subPayment.partnership_id)
          .single();
        const base =
          partnership?.subscription_due_at && new Date(partnership.subscription_due_at) > new Date()
            ? new Date(partnership.subscription_due_at)
            : new Date();
        base.setDate(base.getDate() + (cycleDays[subPayment.billing_cycle] ?? 30));
        await supabase
          .from("affiliate_partnerships")
          .update({ subscription_due_at: base.toISOString() })
          .eq("id", subPayment.partnership_id);
      }
      continue;
    }

    await supabase.from("affiliate_ai_purchases").update({ paid_at: now }).eq("pagbank_order_id", txid).is("paid_at", null);
  }

  return new Response("OK", { status: 200 });
}
