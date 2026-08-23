import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import OpenAI from "openai";

const HISTORY_LIMIT = 20;

function formatCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Monta um resumo compacto da loja (financeiro, vendas, tráfego,
// atendimento) pra dar contexto real ao assistente — sem isso ele só
// responderia genérico, sem saber nada do negócio de verdade.
async function buildStoreSummary(storeId: string, storeName: string) {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [profitRes, ordersRes, lowStockRes, complaintsRes, visitsRes] = await Promise.all([
    admin.rpc("get_profit_summary", { p_store_id: storeId, p_since: monthStart, p_until: now.toISOString() }),
    admin
      .from("orders")
      .select("total, items, status, created_at")
      .eq("store_id", storeId)
      .gte("created_at", monthStart)
      .neq("status", "cancelado"),
    admin.from("products").select("name, stock, stock_alert_threshold").eq("store_id", storeId).eq("active", true).lte("stock", 5),
    admin.from("complaints").select("id, status").eq("store_id", storeId).neq("status", "resolvida"),
    admin.from("site_visits").select("source, converted").eq("store_id", storeId).gte("first_seen_at", monthStart),
  ]);

  const profit = profitRes.data?.[0];
  const orders = ordersRes.data ?? [];
  const orderCount = orders.length;
  const revenue = orders.reduce((s, o) => s + Number(o.total), 0);

  const productRevenue = new Map<string, number>();
  for (const o of orders) {
    for (const item of (o.items as { name: string; quantity: number; line_total?: number; price: number }[]) ?? []) {
      const total = item.line_total ?? item.price * item.quantity;
      productRevenue.set(item.name, (productRevenue.get(item.name) ?? 0) + total);
    }
  }
  const topProducts = [...productRevenue.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, total]) => `${name} (${formatCurrency(total)})`)
    .join(", ");

  const lowStock = (lowStockRes.data ?? []).map((p) => `${p.name} (${p.stock} un.)`).join(", ") || "nenhum";

  const sourceCounts = new Map<string, number>();
  for (const v of visitsRes.data ?? []) {
    const src = v.source || "direto";
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
  }
  const topSources = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s}: ${c}`).join(", ") || "sem dados";
  const totalVisits = visitsRes.data?.length ?? 0;
  const conversions = (visitsRes.data ?? []).filter((v) => v.converted).length;

  const openComplaints = complaintsRes.data?.length ?? 0;

  return `Resumo da loja "${storeName}" (mês atual, até agora):
- Faturamento: ${formatCurrency(revenue)} em ${orderCount} pedido(s)
- Lucro estimado: ${profit ? formatCurrency(Number(profit.profit)) : "sem dado suficiente"}${profit?.missing_cost ? " (alguns produtos sem custo cadastrado)" : ""}
- Produtos que mais venderam: ${topProducts || "nenhum ainda"}
- Produtos com estoque baixo (5 un. ou menos): ${lowStock}
- Tráfego do site: ${totalVisits} visita(s), ${conversions} viraram pedido. Por origem: ${topSources}
- Reclamações em aberto: ${openComplaints}`;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Assistente ainda não configurado" }, { status: 500 });
  }

  const { store_id, message } = (await request.json()) as { store_id?: string; message?: string };
  if (!store_id || !message?.trim()) {
    return Response.json({ error: "store_id e message são obrigatórios" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: store } = await scoped.from("stores").select("id, name").eq("id", store_id).maybeSingle();
  if (!store) {
    return Response.json({ error: "Não autorizado" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  const [{ data: history }, summary] = await Promise.all([
    admin
      .from("assistant_messages")
      .select("role, content")
      .eq("store_id", store_id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    buildStoreSummary(store_id, store.name),
  ]);

  const orderedHistory = (history ?? []).reverse();

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        {
          role: "developer",
          content: `Você é o assistente de negócios de um pequeno mercado/loja de delivery brasileiro, dentro do painel de gestão dele. Fala em português do Brasil, direto e prático, como um consultor experiente que já viu muito mercadinho pequeno. Debate ideias com o dono, questiona quando faz sentido, mas nunca enrola. Usa os dados reais abaixo — nunca invente número. Se não tiver dado suficiente pra responder algo, diz isso claramente.\n\n${summary}`,
        },
        ...orderedHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: message.trim() },
      ],
    });

    const reply = completion.choices[0]?.message?.content ?? "Não consegui pensar numa resposta agora — tenta de novo.";

    await admin.from("assistant_messages").insert([
      { store_id, role: "user", content: message.trim() },
      { store_id, role: "assistant", content: reply },
    ]);

    return Response.json({ reply });
  } catch (err) {
    console.error("Assistente falhou:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Não deu pra falar com o assistente agora. Tenta de novo em instantes." }, { status: 502 });
  }
}
