import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { syncHubOrderPayment } from "@/lib/hub-order-payment-sync";

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
    const now = new Date().toISOString();

    // reference_id pode ser um pedido de loja única (orders), um pedido
    // combinado do hub (hub_orders), a mensalidade de um afiliado
    // (affiliate_subscription_payments) ou um pacote extra de IA
    // (affiliate_ai_purchases) — checa cada um até achar de qual é essa
    // referência antes de marcar como pago.
    const { data: hubOrder } = await supabase.from("hub_orders").select("id, pix_paid_at").eq("id", orderId).maybeSingle();
    if (hubOrder) {
      if (!hubOrder.pix_paid_at) {
        await supabase.from("hub_orders").update({ pix_paid_at: now }).eq("id", orderId);
        // hub_orders.pix_paid_at sozinho não basta — nem o painel de
        // Entregas nem o extrato de comissão leem esse campo, eles leem
        // cada "orders" individual (uma por loja do carrinho). Sem isso o
        // pagamento fica "confirmado" só no pedido combinado, e o
        // entregador continuaria vendo "cobrar na entrega".
        await syncHubOrderPayment(supabase, orderId, "pix");
      }
      return new Response("OK", { status: 200 });
    }

    const { data: order } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
    if (order) {
      await supabase
        .from("orders")
        .update({ pix_paid_at: now, payment_method: "pix" })
        .eq("id", orderId)
        .is("pix_paid_at", null);
      await supabase.rpc("credit_pending_cashback", { p_order_id: orderId });
      return new Response("OK", { status: 200 });
    }

    const { data: subPayment } = await supabase
      .from("affiliate_subscription_payments")
      .select("id, partnership_id, billing_cycle, paid_at")
      .eq("id", orderId)
      .maybeSingle();
    if (subPayment) {
      if (!subPayment.paid_at) {
        await supabase.from("affiliate_subscription_payments").update({ paid_at: now }).eq("id", orderId);
        // Empurra o vencimento a partir de hoje (ou do vencimento atual, se
        // ele ainda não tiver passado — paga adiantado não perde dias).
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
      return new Response("OK", { status: 200 });
    }

    await supabase.from("affiliate_ai_purchases").update({ paid_at: now }).eq("id", orderId).is("paid_at", null);
  }

  return new Response("OK", { status: 200 });
}
