import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Pedido de Hub cria uma linha em "orders" POR LOJA do carrinho, mas a
// confirmação de pagamento (Pix/cartão) só chega marcada no "hub_orders"
// — isso propaga pra cada pedido individual (o que o painel de Entregas e
// o extrato de comissão realmente leem) e cria a comissão da Hub agora
// que o pagamento é de verdade (antes ficava contada desde a criação do
// pedido, mesmo sem pagar — ver schema-v92).
export async function syncHubOrderPayment(
  admin: SupabaseClient,
  hubOrderId: string,
  method: "pix" | "cartao",
  cardDetails?: { lastDigits: string | null; brand: string | null },
) {
  const { data: orders } = await admin
    .from("orders")
    .select("id, store_id, total, pix_paid_at, card_paid_at")
    .eq("hub_order_id", hubOrderId);

  for (const order of (orders ?? []) as {
    id: string;
    store_id: string;
    total: number;
    pix_paid_at: string | null;
    card_paid_at: string | null;
  }[]) {
    const alreadyPaid = method === "pix" ? order.pix_paid_at : order.card_paid_at;
    if (alreadyPaid) continue;

    const now = new Date().toISOString();
    const patch: Record<string, unknown> =
      method === "pix"
        ? { payment_method: "pix", pix_paid_at: now }
        : {
            payment_method: "cartao",
            card_paid_at: now,
            card_last_digits: cardDetails?.lastDigits ?? null,
            card_brand: cardDetails?.brand ?? null,
          };
    await admin.from("orders").update(patch).eq("id", order.id);

    const { data: partnership } = await admin
      .from("affiliate_partnerships")
      .select("id, commission_percent")
      .eq("module_store_id", order.store_id)
      .eq("active", true)
      .maybeSingle();
    if (!partnership) continue;

    const { data: existingSettlement } = await admin
      .from("affiliate_settlement_transactions")
      .select("id")
      .eq("order_id", order.id)
      .eq("type", "venda")
      .maybeSingle();
    if (existingSettlement) continue;

    const amount = Math.round((Number(order.total) * (100 - partnership.commission_percent)) / 100 * 100) / 100;
    if (amount > 0) {
      await admin.from("affiliate_settlement_transactions").insert({
        partnership_id: partnership.id,
        type: "venda",
        amount,
        order_id: order.id,
        note: method === "pix" ? "Venda via vitrine do hub (Pix confirmado)" : "Venda via vitrine do hub (cartão confirmado)",
      });
    }
  }
}
