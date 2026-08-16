import "server-only";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

// Roda periodicamente (ver vercel.json) e varre toda loja ativa procurando
// 3 situações que merecem um empurrão pro dono, mesmo longe do painel:
// estoque baixo, pedido parado sem confirmar, entrega demorando. Cada tipo
// tem seu próprio liga/desliga em stores.alert_*_enabled — nunca manda
// nada pra quem desligou. alert_notifications_log evita repetir o mesmo
// aviso a cada rodada (só alerta de novo depois do cooldown).
const STALLED_MINUTES = 20;
const DELIVERY_DELAY_MINUTES = 45;
const ALERT_COOLDOWN_HOURS = 6;

type Store = {
  id: string;
  name: string;
  alert_low_stock_enabled: boolean;
  alert_stalled_order_enabled: boolean;
  alert_delivery_delay_enabled: boolean;
};

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
    .select("id, name, alert_low_stock_enabled, alert_stalled_order_enabled, alert_delivery_delay_enabled")
    .eq("active", true);

  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - ALERT_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const stalledCutoff = new Date(now.getTime() - STALLED_MINUTES * 60 * 1000).toISOString();
  const deliveryCutoff = new Date(now.getTime() - DELIVERY_DELAY_MINUTES * 60 * 1000).toISOString();

  let alertsSent = 0;
  const errors: string[] = [];

  for (const store of (stores ?? []) as Store[]) {
    try {
      const alreadyAlerted = await loadAlreadyAlerted(supabase, store.id, cooldownCutoff);

      if (store.alert_low_stock_enabled) {
        const { data: products } = await supabase
          .from("products")
          .select("id, name, stock, stock_alert_threshold")
          .eq("store_id", store.id)
          .eq("active", true);
        const lowStock = (products ?? []).filter(
          (p) => p.stock <= p.stock_alert_threshold && !alreadyAlerted.estoque_baixo.has(p.id),
        );
        if (lowStock.length > 0) {
          const names = lowStock.map((p) => p.name);
          const body = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} e mais ${names.length - 3}`;
          const sent = await sendPush(supabase, store.id, "📦 Estoque baixo", body, "/painel/produtos");
          if (sent > 0) {
            await logAlerts(supabase, store.id, "estoque_baixo", lowStock.map((p) => p.id));
            alertsSent += 1;
          }
        }
      }

      if (store.alert_stalled_order_enabled) {
        const { data: stalledOrders } = await supabase
          .from("orders")
          .select("id, customer_name, created_at")
          .eq("store_id", store.id)
          .in("status", ["pendente", "confirmado"])
          .lt("created_at", stalledCutoff);
        const newStalled = (stalledOrders ?? []).filter((o) => !alreadyAlerted.pedido_parado.has(o.id));
        if (newStalled.length > 0) {
          const body =
            newStalled.length === 1
              ? `Pedido de ${newStalled[0].customer_name} parado há mais de ${STALLED_MINUTES}min`
              : `${newStalled.length} pedidos parados há mais de ${STALLED_MINUTES}min sem confirmar`;
          const sent = await sendPush(supabase, store.id, "⏱️ Pedido parado", body, "/painel/pedidos");
          if (sent > 0) {
            await logAlerts(supabase, store.id, "pedido_parado", newStalled.map((o) => o.id));
            alertsSent += 1;
          }
        }
      }

      if (store.alert_delivery_delay_enabled) {
        const { data: delayedOrders } = await supabase
          .from("orders")
          .select("id, customer_name, out_for_delivery_at")
          .eq("store_id", store.id)
          .eq("status", "entregando")
          .not("out_for_delivery_at", "is", null)
          .lt("out_for_delivery_at", deliveryCutoff);
        const newDelayed = (delayedOrders ?? []).filter((o) => !alreadyAlerted.entrega_demorada.has(o.id));
        if (newDelayed.length > 0) {
          const body =
            newDelayed.length === 1
              ? `Entrega de ${newDelayed[0].customer_name} a caminho há mais de ${DELIVERY_DELAY_MINUTES}min`
              : `${newDelayed.length} entregas a caminho há mais de ${DELIVERY_DELAY_MINUTES}min`;
          const sent = await sendPush(supabase, store.id, "🛵 Entrega demorando", body, "/painel/entregas");
          if (sent > 0) {
            await logAlerts(supabase, store.id, "entrega_demorada", newDelayed.map((o) => o.id));
            alertsSent += 1;
          }
        }
      }
    } catch (err) {
      errors.push(`${store.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return Response.json({ stores_checked: stores?.length ?? 0, alerts_sent: alertsSent, errors });
}

async function loadAlreadyAlerted(supabase: AdminClient, storeId: string, cooldownCutoff: string) {
  const { data } = await supabase
    .from("alert_notifications_log")
    .select("alert_type, entity_id")
    .eq("store_id", storeId)
    .gte("sent_at", cooldownCutoff);
  const result = {
    estoque_baixo: new Set<string>(),
    pedido_parado: new Set<string>(),
    entrega_demorada: new Set<string>(),
  };
  for (const row of data ?? []) {
    result[row.alert_type as keyof typeof result]?.add(row.entity_id);
  }
  return result;
}

async function logAlerts(supabase: AdminClient, storeId: string, alertType: string, entityIds: string[]) {
  await supabase
    .from("alert_notifications_log")
    .insert(entityIds.map((entity_id) => ({ store_id: storeId, alert_type: alertType, entity_id })));
}

async function sendPush(supabase: AdminClient, storeId: string, title: string, body: string, url: string) {
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("store_id", storeId);
  if (!subscriptions || subscriptions.length === 0) return 0;

  const payload = JSON.stringify({ title, body, url });
  let sent = 0;
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
  return sent;
}
