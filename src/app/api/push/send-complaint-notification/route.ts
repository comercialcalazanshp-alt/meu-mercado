import "server-only";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const CATEGORY_LABEL: Record<string, string> = {
  produto_errado: "Produto errado",
  produto_danificado: "Produto danificado",
  faltou_item: "Faltou item",
  atraso_entrega: "Atraso na entrega",
  cobranca_errada: "Cobrança errada",
  atendimento: "Atendimento",
  outro: "Outro problema",
};

// Chamada só pelo gatilho do banco (notify_new_complaint via pg_net) —
// reclamação é urgente, por isso avisa na hora em vez de esperar o cron de
// 15min dos outros alertas. Só o dono recebe (member_id nulo) — assunto de
// gestão da loja, não da equipe de entrega.
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
  const { store_id, customer_name, category } = body as {
    store_id: string;
    complaint_id: string;
    customer_name: string;
    category: string;
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
    title: "⚠️ Nova reclamação",
    body: `${customer_name} · ${CATEGORY_LABEL[category] ?? category}`,
    url: "/painel/reclamacoes",
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
