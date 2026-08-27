import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { refundEfiPix, makeTxid } from "@/lib/efi-pix";

// Devolve (total) o Pix de um pedido pro cliente — só o dono da loja pode
// disparar, e só se o pedido realmente foi pago via Pix e ainda não foi
// devolvido antes (evita devolver duas vezes o mesmo pedido).
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { order_id } = (await request.json()) as { order_id?: string };
  if (!order_id) {
    return Response.json({ error: "order_id é obrigatório" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // A policy de select em orders já restringe a store_id in my_store_ids()
  // — se a linha não vier, o pedido não é dessa loja (ou não existe).
  const { data: order } = await scoped
    .from("orders")
    .select("id, total, payment_method, pix_paid_at, pix_end_to_end_id, pix_refunded_at")
    .eq("id", order_id)
    .maybeSingle();

  if (!order) {
    return Response.json({ error: "Pedido não encontrado" }, { status: 404 });
  }
  if (order.payment_method !== "pix" || !order.pix_paid_at) {
    return Response.json({ error: "Esse pedido não foi pago via Pix" }, { status: 400 });
  }
  if (!order.pix_end_to_end_id) {
    return Response.json({ error: "Não temos o identificador do Pix desse pedido — devolução manual necessária" }, { status: 400 });
  }
  if (order.pix_refunded_at) {
    return Response.json({ error: "Esse Pix já foi devolvido" }, { status: 409 });
  }

  const admin = getSupabaseAdmin();
  try {
    await refundEfiPix(order.pix_end_to_end_id, makeTxid(order.id), Number(order.total));
    await admin
      .from("orders")
      .update({ pix_refunded_at: new Date().toISOString(), refund_resolved: true })
      .eq("id", order.id);
    // Desfaz a comissão do afiliado (se essa venda tinha uma lançada) e o
    // cashback/bônus já creditado — sem isso o dinheiro devolvido pro
    // cliente ainda contaria como venda no extrato do afiliado, e o
    // cliente ficaria com cashback de um pedido que foi estornado.
    await admin.rpc("reverse_order_settlement", { p_order_id: order.id });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Efí refund-pix failed:", err instanceof Error ? err.message : err, (err as { body?: unknown })?.body);
    return Response.json({ error: "Não deu pra devolver o Pix — tente de novo ou faça manualmente" }, { status: 502 });
  }
}
