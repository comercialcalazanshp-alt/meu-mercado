import "server-only";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Chamada só pelo gatilho do banco (notify_delivery_issue via pg_net) —
// mesmo padrão de send-complaint-notification (schema-v79). Só o dono
// recebe (member_id nulo), já que é assunto de gestão da loja.
export async function POST(request: Request) {
  const secret = request.headers.get("x-push-secret");
  if (!secret || secret !== process.env.PUSH_TRIGGER_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    return new Response("Push não configurado", { status: 500 });
  }
  webpush.setVapidDetails("mailto:suporte@meumercado.app", vapidPublic, vapidPrivate);

  const body = await request.json();
  const { store_id, description } = body as {
    store_id: string;
    order_id: string;
    description: string;
  };

  const supabase = getSupabaseAdmin();
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("store_id", store_id)
    .is("member_id", null);

  if (!subscriptions || subscriptions.length === 0) {
    return Response.json({ sent: 0 });
  }

  const payload = JSON.stringify({
    title: "🚨 Problema na entrega",
    body: description.slice(0, 100),
    url: "/painel/entregas",
  });

  let sent = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent += 1;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }),
  );

  return Response.json({ sent });
}
