import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import ReciboHubClient, { type HubReceiptRow } from "./recibo-hub-client";

export const dynamic = "force-dynamic";

export default async function ReciboHub({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabase();

  const { data } = await supabase.rpc("get_hub_order_receipt", { p_hub_order_id: id });
  const rows = (data ?? []) as HubReceiptRow[];

  if (rows.length === 0) notFound();

  return <ReciboHubClient rows={rows} />;
}
