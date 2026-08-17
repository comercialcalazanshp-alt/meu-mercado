import "server-only";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Roda 1x por semana (segunda de manhã, ver schema-v78.sql) e manda um
// resumo dos últimos 7 dias pro dono de cada loja com o recurso ligado.
// Fica só em faturamento + pedidos — lucro de verdade (get_profit_summary)
// depende de auth.uid()/my_store_ids() pra achar a loja, que não existe
// nesse contexto (chamada via service role, sem sessão de usuário), então
// recalcular isso aqui seria duplicar a lógica de custo. O Dashboard já
// mostra o P&L completo pra quem quiser o detalhe.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    return Response.json({ error: "Push não configurado" }, { status: 500 });
  }
  webpush.setVapidDetails("mailto:suporte@meumercado.app", vapidPublic, vapidPrivate);

  const supabase = getSupabaseAdmin();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, name")
    .eq("active", true)
    .eq("weekly_summary_enabled", true);

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  let sent = 0;
  const errors: string[] = [];

  for (const store of stores ?? []) {
    try {
      const { data: orders } = await supabase
        .from("orders")
        .select("total")
        .eq("store_id", store.id)
        .neq("status", "cancelado")
        .gte("created_at", since);
      const revenue = (orders ?? []).reduce((s, o) => s + Number(o.total), 0);
      const count = orders?.length ?? 0;
      if (count === 0) continue; // nada pra resumir, não manda push vazio

      const body = `${formatCurrency(revenue)} em ${count} pedido${count === 1 ? "" : "s"} — abra o Dashboard pra ver o lucro completo`;
      const { data: subscriptions } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("store_id", store.id)
        .is("member_id", null);
      if (!subscriptions || subscriptions.length === 0) continue;

      const payload = JSON.stringify({ title: "📊 Resumo da semana", body, url: "/painel/dashboard" });
      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
            sent += 1;
          } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            }
          }
        }),
      );
    } catch (err) {
      errors.push(`${store.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return Response.json({ stores_checked: stores?.length ?? 0, pushes_sent: sent, errors });
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
