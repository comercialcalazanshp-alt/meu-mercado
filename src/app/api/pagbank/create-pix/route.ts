import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Chamada pelo site logo depois que o pedido é criado (checkout já validou
// preço/estoque e gravou o pedido) — aqui só pedimos ao PagBank pra gerar
// o QR code Pix daquele valor exato, e guardamos o retorno no pedido.
export async function POST(request: Request) {
  const token = process.env.PAGBANK_TOKEN;
  if (!token) {
    return Response.json({ error: "Pagamento Pix não configurado" }, { status: 500 });
  }

  const { order_id } = (await request.json()) as { order_id: string };
  if (!order_id) {
    return Response.json({ error: "order_id é obrigatório" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from("orders")
    .select("id, customer_name, customer_phone, total")
    .eq("id", order_id)
    .maybeSingle();

  if (!order) {
    return Response.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const amountCents = Math.round(Number(order.total) * 100);
  const phoneDigits = (order.customer_phone || "").replace(/\D/g, "");

  const pagbankBody = {
    reference_id: order.id,
    customer: {
      name: order.customer_name || "Cliente",
      email: `cliente-${order.id}@meumercado.app`,
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
    qr_codes: [{ amount: { value: amountCents }, arrangements: ["PAGBANK"] }],
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

  if (!pagbankRes.ok) {
    return Response.json(
      { error: "Não deu pra gerar o Pix", details: pagbankData },
      { status: 502 },
    );
  }

  const qrCode = pagbankData.qr_codes?.[0];
  const qrText = qrCode?.text ?? null;
  const qrImageLink = qrCode?.links?.find(
    (l: { rel: string; href: string }) => l.rel === "QRCODE.PNG",
  )?.href;

  await supabase
    .from("orders")
    .update({
      pagbank_order_id: pagbankData.id,
      pix_qr_code_text: qrText,
      pix_qr_code_image: qrImageLink ?? null,
    })
    .eq("id", order.id);

  return Response.json({
    qr_code_text: qrText,
    qr_code_image: qrImageLink ?? null,
  });
}
