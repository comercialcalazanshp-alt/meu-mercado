import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import OpenAI from "openai";

const HISTORY_LIMIT = 20;
const PAGE_SIZE = 1000;

function formatCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Supabase corta em 1000 linhas por página mesmo sem limite pedido — loja
// com catálogo/histórico grande perderia dado sem aviso nenhum sem paginar.
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data } = await build(from, from + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

type OrderRow = {
  total: number;
  discount_amount: number | null;
  items: { name: string; quantity: number; line_total?: number; price: number; product_id?: string }[];
  status: string;
  payment_method: string | null;
  payment_split: { method: string; amount: number }[] | null;
  created_at: string;
};

type ProductRow = {
  id: string;
  name: string;
  price: number;
  cost_price: number | null;
  category: string | null;
  stock: number;
  stock_alert_threshold: number;
  active: boolean;
};

// Monta um resumo completo da loja (financeiro real com margem por produto,
// formas de pagamento, fiado/crediário, estoque, tráfego, atendimento) pra
// dar ao assistente acesso ao mesmo tipo de dado que qualquer análise feita
// direto no banco usa — sem isso ele só respondia com número agregado solto
// (ex: "lucro estimado" sem detalhe nenhum de custo por produto), incapaz
// de responder pergunta específica de margem mesmo quando o custo já
// estava cadastrado.
async function buildStoreSummary(storeId: string, storeName: string) {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [profitRes, orders, products, creditCustomersRes, complaintsRes, visitsRes, expensesRes] = await Promise.all([
    admin.rpc("get_profit_summary", { p_store_id: storeId, p_since: monthStart, p_until: now.toISOString() }),
    fetchAllRows<OrderRow>((from, to) =>
      admin
        .from("orders")
        .select("total, discount_amount, items, status, payment_method, payment_split, created_at")
        .eq("store_id", storeId)
        .gte("created_at", monthStart)
        .range(from, to),
    ),
    fetchAllRows<ProductRow>((from, to) =>
      admin
        .from("products")
        .select("id, name, price, cost_price, category, stock, stock_alert_threshold, active")
        .eq("store_id", storeId)
        .eq("active", true)
        .range(from, to),
    ),
    admin.from("credit_customers").select("id, name, balance, credit_limit").eq("store_id", storeId),
    admin.from("complaints").select("id, status").eq("store_id", storeId).neq("status", "resolvida"),
    admin.from("site_visits").select("source, converted").eq("store_id", storeId).gte("first_seen_at", monthStart),
    admin.from("expenses").select("amount, category").eq("store_id", storeId).gte("expense_date", monthStart.slice(0, 10)),
  ]);

  const profit = profitRes.data?.[0];
  const productById = new Map(products.map((p) => [p.id, p]));

  const validOrders = orders.filter((o) => o.status !== "cancelado");
  const cancelledCount = orders.length - validOrders.length;
  const orderCount = validOrders.length;
  const revenue = validOrders.reduce((s, o) => s + Number(o.total), 0);
  const totalDiscount = validOrders.reduce((s, o) => s + Number(o.discount_amount || 0), 0);
  const ticketMedio = orderCount > 0 ? revenue / orderCount : 0;

  // forma de pagamento
  const payMix = new Map<string, number>();
  for (const o of validOrders) {
    if (o.payment_method === "dividido" && o.payment_split) {
      for (const p of o.payment_split) payMix.set(p.method, (payMix.get(p.method) ?? 0) + Number(p.amount));
    } else {
      const m = o.payment_method || "desconhecido";
      payMix.set(m, (payMix.get(m) ?? 0) + Number(o.total));
    }
  }
  const payMixText =
    [...payMix.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${formatCurrency(v)} (${((v / revenue) * 100).toFixed(0)}%)`)
      .join(", ") || "sem vendas ainda";

  // produto: faturamento, custo, margem
  const productAgg = new Map<string, { revenue: number; cost: number; qty: number; hasCost: boolean }>();
  for (const o of validOrders) {
    for (const item of o.items ?? []) {
      const lineTotal = item.line_total ?? item.price * item.quantity;
      const cur = productAgg.get(item.name) ?? { revenue: 0, cost: 0, qty: 0, hasCost: false };
      cur.revenue += lineTotal;
      cur.qty += item.quantity;
      const prod = item.product_id ? productById.get(item.product_id) : undefined;
      if (prod?.cost_price != null) {
        cur.cost += Number(prod.cost_price) * item.quantity;
        cur.hasCost = true;
      }
      productAgg.set(item.name, cur);
    }
  }
  const topProducts =
    [...productAgg.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([name, d]) => {
        const margin = d.hasCost ? `, margem ${formatCurrency(d.revenue - d.cost)} (${(((d.revenue - d.cost) / d.revenue) * 100).toFixed(0)}%)` : ", sem custo cadastrado";
        return `${name}: ${d.qty}x, faturou ${formatCurrency(d.revenue)}${margin}`;
      })
      .join("; ") || "nenhum ainda";

  // qualidade do catálogo
  const negativeMargin = products.filter((p) => p.cost_price !== null && p.cost_price > p.price);
  const noCategoryCount = products.filter((p) => !p.category || !p.category.trim()).length;
  const noCostCount = products.filter((p) => p.cost_price === null).length;
  const lowStock = products.filter((p) => p.stock <= p.stock_alert_threshold);

  // fiado / crediário
  const creditCustomers = creditCustomersRes.data ?? [];
  const totalReceivable = creditCustomers.reduce((s, c) => s + Number(c.balance), 0);
  const topDebtors = [...creditCustomers]
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5)
    .map((c) => `${c.name} (${formatCurrency(c.balance)}${c.credit_limit ? `, limite ${formatCurrency(c.credit_limit)}` : ", sem limite"})`)
    .join(", ") || "nenhum";

  // despesas
  const expenses = expensesRes.data ?? [];
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const expensesByCategory = new Map<string, number>();
  for (const e of expenses) expensesByCategory.set(e.category, (expensesByCategory.get(e.category) ?? 0) + Number(e.amount));
  const expensesText =
    [...expensesByCategory.entries()].map(([k, v]) => `${k}: ${formatCurrency(v)}`).join(", ") || "nenhuma despesa lançada";

  // tráfego
  const sourceCounts = new Map<string, number>();
  for (const v of visitsRes.data ?? []) {
    const src = v.source || "direto";
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
  }
  const topSources = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s}: ${c}`).join(", ") || "sem dados";
  const totalVisits = visitsRes.data?.length ?? 0;
  const conversions = (visitsRes.data ?? []).filter((v) => v.converted).length;

  const openComplaints = complaintsRes.data?.length ?? 0;

  return `Resumo completo da loja "${storeName}" (mês atual até agora, ${products.length} produtos ativos no catálogo):

FINANCEIRO
- Faturamento: ${formatCurrency(revenue)} em ${orderCount} venda(s) válida(s) (${cancelledCount} cancelada(s)/estornada(s) não contam)
- Ticket médio: ${formatCurrency(ticketMedio)}
- Desconto dado no período: ${formatCurrency(totalDiscount)}
- Despesas cadastradas: ${formatCurrency(totalExpenses)} (${expensesText})
- Lucro líquido (via get_profit_summary, considera custo real de cada venda e despesas): ${profit ? formatCurrency(Number(profit.profit)) : "sem dado suficiente"}${profit?.missing_cost ? " — ATENÇÃO: pelo menos uma venda do período tem produto sem custo cadastrado, então esse lucro pode estar um pouco subestimado" : ""}

FORMAS DE PAGAMENTO
${payMixText}

FIADO / CREDIÁRIO
- Total a receber agora: ${formatCurrency(totalReceivable)} (${creditCustomers.length} cliente(s) cadastrado(s))
- Maiores devedores: ${topDebtors}

PRODUTOS MAIS VENDIDOS (com margem quando o custo está cadastrado)
${topProducts}

QUALIDADE DO CATÁLOGO (dados que faltam e afetam a precisão de tudo acima)
- Produtos sem preço de custo cadastrado: ${noCostCount} de ${products.length}
- Produtos sem categoria: ${noCategoryCount}
- Produtos vendendo no prejuízo (custo cadastrado maior que o preço de venda — bug real, avisar o dono): ${negativeMargin.length > 0 ? negativeMargin.map((p) => `${p.name} (custo ${formatCurrency(Number(p.cost_price))} > venda ${formatCurrency(p.price)})`).join(", ") : "nenhum"}
- Produtos com estoque no limite de alerta configurado: ${lowStock.length > 0 ? lowStock.map((p) => `${p.name} (${p.stock} un., alerta em ${p.stock_alert_threshold})`).join(", ") : "nenhum"}

TRÁFEGO DO SITE
- ${totalVisits} visita(s), ${conversions} viraram pedido. Por origem: ${topSources}

ATENDIMENTO
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
  if (message.length > 2000) {
    return Response.json({ error: "Mensagem muito longa (máximo 2000 caracteres)" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: myStoreIds, error: storeIdsError } = await scoped.rpc("my_store_ids");
  if (storeIdsError || !myStoreIds?.some((id: string) => id === store_id)) {
    return Response.json({ error: "Essa loja não é sua" }, { status: 403 });
  }

  const { data: store } = await scoped.from("stores").select("id, name").eq("id", store_id).maybeSingle();
  if (!store) {
    return Response.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { data: enabled } = await scoped.rpc("affiliate_assistant_enabled", { p_store_id: store_id });
  if (!enabled) {
    return Response.json({ error: "Esse recurso não está incluído no seu plano. Fala com quem administra o Hub pra liberar." }, { status: 402 });
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
          content: `Você é o sócio de negócios do dono desse mercado/loja de delivery brasileiro — não um chatbot de suporte, um sócio de verdade que olha os números com ele. Fala em português do Brasil, direto e prático. Debate ideias, questiona quando faz sentido, discorda quando os dados apontam outra coisa, mas nunca enrola.

Regras de como usar os dados abaixo:
- Nunca invente número — todo valor que você disser tem que vir literalmente do resumo abaixo.
- Antes de dar um diagnóstico de margem/lucro, sempre olhe a seção "QUALIDADE DO CATÁLOGO" primeiro — se tiver produto sem custo cadastrado, isso limita a precisão de QUALQUER conta de lucro, avise isso explicitamente, com o número exato de produtos afetados.
- Se um produto aparece com "margem" no resumo, use esse número real — não diga "não tenho dado suficiente" se o dado está ali.
- Se um produto aparece "sem custo cadastrado", aí sim não dá pra saber a margem dele — diga isso especificamente pra aquele produto, não generalize pra todos.
- Trate o fiado/crediário como dinheiro que ainda não entrou no caixa, não como faturamento normal — se for relevante pra pergunta, aponte isso.
- Se algo no resumo parece um erro real do sistema (ex: produto vendendo no prejuízo), avise isso como prioridade alta, não enterre no meio do texto.
- Se não tiver dado suficiente pra responder algo específico, diga isso claramente e diga exatamente o que falta pra você conseguir responder.

${summary}`,
        },
        ...orderedHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: message.trim() },
      ],
    });

    const reply = completion.choices[0]?.message?.content?.trim() || "Não consegui pensar numa resposta agora — tenta de novo.";

    const { error: insertError } = await admin.from("assistant_messages").insert([
      { store_id, role: "user", content: message.trim() },
      { store_id, role: "assistant", content: reply },
    ]);
    if (insertError) {
      console.error("Não salvou a conversa do assistente:", insertError.message);
    }

    return Response.json({ reply });
  } catch (err) {
    console.error("Assistente falhou:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Não deu pra falar com o assistente agora. Tenta de novo em instantes." }, { status: 502 });
  }
}
