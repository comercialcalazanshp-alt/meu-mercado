import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import ReciboClient, { type OrderReceipt } from "./recibo-client";

export const dynamic = "force-dynamic";

export default async function Recibo({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const supabase = getSupabase();

  const { data } = await supabase.rpc("get_order_receipt", { p_order_id: id });
  const order = data?.[0] as OrderReceipt | undefined;

  if (!order || order.store_slug !== slug) notFound();

  return <ReciboClient order={order} />;
}
