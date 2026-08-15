import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isValidCPF } from "@/lib/cpf";

// Recebe o cartão já criptografado no navegador (nunca em texto puro) e
// manda pro PagBank cobrar o valor exato do pedido. Só à vista (1x) por
// enquanto, pra manter simples.
export async function POST(request: Request) {
  const token = process.env.PAGBANK_TOKEN;
  if (!token) {
    return Response.json({ error: "Pagamento não configurado" }, { status: 500 });
  }

  const { order_id, encrypted_card, holder_name, holder_cpf } = (await request.json()) as {
    order_id: string;
    encrypted_card: string;
    holder_name: string;
    holder_cpf: string;
  };

  if (!order_id || !encrypted_card || !holder_name || !holder_cpf) {
    return Response.json({ error: "Dados do cartão incompletos" }, { status: 400 });
  }

  if (!isValidCPF(holder_cpf)) {
    return Response.json({ error: "CPF do titular do cartão inválido" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from("orders")
    .select("id, customer_name, customer_phone, total, card_paid_at")
    .eq("id", order_id)
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

  const amountCents = Math.round(Number(order.total) * 100);
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
          installments: 1,
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

  await supabase
    .from("orders")
    .update({
      pagbank_order_id: pagbankData.id,
      payment_method: "cartao",
      card_paid_at: new Date().toISOString(),
      card_last_digits: charge.payment_method?.card?.last_digits ?? null,
      card_brand: charge.payment_method?.card?.brand ?? null,
    })
    .eq("id", order.id);

  return Response.json({ paid: true });
}
