import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isValidCPF } from "@/lib/cpf";
import { createEfiPixCharge, makeTxid } from "@/lib/efi-pix";

// Mesma função do antigo /api/pagbank/create-pix, só que gerando o Pix via
// Efí em vez de PagBank — chamada pelo site logo depois que o pedido é
// criado. Guarda o txid no mesmo campo pagbank_order_id que já existia
// (evita renomear coluna em 4 tabelas só por causa da troca de provedor).
export async function POST(request: Request) {
  const { order_id, hub_order_id, customer_tax_id } = (await request.json()) as {
    order_id?: string;
    hub_order_id?: string;
    customer_tax_id: string;
  };
  const table = hub_order_id ? "hub_orders" : "orders";
  const id = hub_order_id ?? order_id;
  if (!id) {
    return Response.json({ error: "order_id é obrigatório" }, { status: 400 });
  }
  if (!customer_tax_id || !isValidCPF(customer_tax_id)) {
    return Response.json({ error: "CPF do cliente inválido" }, { status: 400 });
  }
  const cpfDigits = customer_tax_id.replace(/\D/g, "");

  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from(table)
    .select("id, customer_name, total")
    .eq("id", id)
    .maybeSingle();

  if (!order) {
    return Response.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  try {
    const charge = await createEfiPixCharge({
      txid: makeTxid(order.id),
      amount: Number(order.total),
      customerName: order.customer_name || "Cliente",
      customerTaxId: cpfDigits,
      description: "Pedido " + order.id.slice(0, 8),
    });

    await supabase
      .from(table)
      .update({
        pagbank_order_id: charge.txid,
        pix_qr_code_text: charge.qrCodeText,
        pix_qr_code_image: charge.qrCodeImage,
      })
      .eq("id", order.id);

    return Response.json({ qr_code_text: charge.qrCodeText, qr_code_image: charge.qrCodeImage });
  } catch (err) {
    console.error("Efí create-pix failed:", err instanceof Error ? err.message : err, (err as { body?: unknown })?.body);
    return Response.json({ error: "Não deu pra gerar o Pix" }, { status: 502 });
  }
}
