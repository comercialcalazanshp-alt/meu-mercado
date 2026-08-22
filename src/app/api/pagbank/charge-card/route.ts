import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isValidCPF } from "@/lib/cpf";
import { syncHubOrderPayment } from "@/lib/hub-order-payment-sync";

// Recebe o cartão já criptografado no navegador (nunca em texto puro) e
// manda pro PagBank cobrar o valor exato do pedido. Aceita parcelamento
// (até 3x) — o valor total cobrado do cliente não muda com o número de
// parcelas (confirmado na documentação da PagBank: "amount.value" é
// sempre o total do pedido, não por parcela).
export async function POST(request: Request) {
  const token = process.env.PAGBANK_TOKEN;
  if (!token) {
    return Response.json({ error: "Pagamento não configurado" }, { status: 500 });
  }

  const { order_id, hub_order_id, encrypted_card, holder_name, holder_cpf, installments } = (await request.json()) as {
    order_id?: string;
    hub_order_id?: string;
    encrypted_card: string;
    holder_name: string;
    holder_cpf: string;
    installments?: number;
  };
  const installmentCount = Number.isInteger(installments) && installments! >= 1 && installments! <= 3 ? installments! : 1;
  const table = hub_order_id ? "hub_orders" : "orders";
  const id = hub_order_id ?? order_id;

  if (!id || !encrypted_card || !holder_name || !holder_cpf) {
    return Response.json({ error: "Dados do cartão incompletos" }, { status: 400 });
  }

  if (!isValidCPF(holder_cpf)) {
    return Response.json({ error: "CPF do titular do cartão inválido" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const storeIdColumn = hub_order_id ? "hub_store_id" : "store_id";
  const { data: order } = await supabase
    .from(table)
    .select(`id, customer_name, customer_phone, total, card_paid_at, ${storeIdColumn}`)
    .eq("id", id)
    .maybeSingle();

  if (!order) {
    return Response.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  // Sem isso, esse endpoint público aceitaria tentativas de cobrança
  // repetidas pro mesmo pedido — um jeito clássico de testar cartão roubado
  // em massa (o pedido já pago vira um alvo reutilizável pra validar
  // números). Um pedido só pode ser cobrado uma vez.
  if (order.card_paid_at) {
    return Response.json({ error: "Esse pedido já foi pago." }, { status: 409 });
  }

  // Sem juros por padrão — o valor cobrado só muda se a loja tiver ligado
  // juros no parcelamento (painel/configurações). O total do pedido em si
  // (order.total) nunca muda, só o valor cobrado no cartão quando parcelado.
  let chargeTotal = Number(order.total);
  if (installmentCount > 1) {
    const storeId = (order as unknown as Record<string, string>)[storeIdColumn];
    const { data: storeSettings } = await supabase
      .from("stores")
      .select("card_installment_interest_enabled, card_installment_interest_percent")
      .eq("id", storeId)
      .maybeSingle();
    if (storeSettings?.card_installment_interest_enabled && storeSettings.card_installment_interest_percent > 0) {
      chargeTotal = chargeTotal * (1 + (storeSettings.card_installment_interest_percent / 100) * (installmentCount - 1));
    }
  }

  const amountCents = Math.round(chargeTotal * 100);
  const phoneDigits = (order.customer_phone || "").replace(/\D/g, "");
  const cpfDigits = holder_cpf.replace(/\D/g, "");

  const pagbankBody = {
    reference_id: order.id,
    customer: {
      name: order.customer_name || "Cliente",
      email: `cliente-${order.id}@meumercado.app`,
      tax_id: cpfDigits,
      phones: phoneDigits
        ? [
            {
              country: "55",
              area: phoneDigits.slice(0, 2) || "11",
              number: phoneDigits.slice(2) || phoneDigits,
              type: "MOBILE",
            },
          ]
        : undefined,
    },
    items: [{ name: "Pedido " + order.id.slice(0, 8), quantity: 1, unit_amount: amountCents }],
    charges: [
      {
        reference_id: order.id,
        description: "Pedido " + order.id.slice(0, 8),
        amount: { value: amountCents, currency: "BRL" },
        payment_method: {
          type: "CREDIT_CARD",
          installments: installmentCount,
          capture: true,
          card: { encrypted: encrypted_card },
          holder: { name: holder_name, tax_id: cpfDigits },
        },
      },
    ],
    notification_urls: ["https://meu-mercado-blond.vercel.app/api/pagbank/webhook"],
  };

  const pagbankRes = await fetch("https://api.pagseguro.com/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pagbankBody),
  });

  const pagbankData = await pagbankRes.json();
  const charge = pagbankData.charges?.[0];

  if (!pagbankRes.ok || !charge || charge.status !== "PAID") {
    // Só repassamos pro cliente o motivo quando é uma recusa de cartão de
    // verdade (banco emissor). Erros de integração (ex: whitelist do
    // PagBank) ficam só no log do servidor — não fazem sentido pro cliente.
    const declineReason = charge?.status === "DECLINED" ? charge?.payment_response?.message : null;
    console.error("PagBank charge failed:", JSON.stringify(pagbankData));
    return Response.json(
      { error: "Pagamento não aprovado", reason: declineReason },
      { status: 502 },
    );
  }

  const lastDigits = charge.payment_method?.card?.last_digits ?? null;
  const brand = charge.payment_method?.card?.brand ?? null;

  await supabase
    .from(table)
    .update({
      pagbank_order_id: pagbankData.id,
      payment_method: "cartao",
      card_paid_at: new Date().toISOString(),
      card_last_digits: lastDigits,
      card_brand: brand,
    })
    .eq("id", order.id);

  // Pedido de Hub: a confirmação acima só marca o "hub_orders" combinado —
  // precisa propagar pra cada "orders" individual (uma por loja do
  // carrinho), que é o que o painel de Entregas e o extrato de comissão
  // realmente leem, e só agora criar a comissão (pagamento confirmado).
  if (hub_order_id) {
    await syncHubOrderPayment(supabase, hub_order_id, "cartao", { lastDigits, brand });
  }

  return Response.json({ paid: true });
}
