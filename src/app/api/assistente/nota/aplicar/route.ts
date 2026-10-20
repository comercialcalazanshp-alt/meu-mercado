import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { authorizeFullAccess } from "@/lib/assistente-auth";

type Item = { produto_id?: unknown; custo_unitario?: unknown; estoque_final?: unknown };

// Grava o que o dono conferiu na tela: custo e estoque. O preço de venda NÃO
// é mexido aqui. Cada item é validado e só mexe em produto da própria loja.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { store_id?: string; fornecedor?: string; numero?: string; repetir?: boolean; itens?: Item[] };
  const auth = await authorizeFullAccess(request, body.store_id);
  if ("error" in auth) return auth.error;
  const storeId = body.store_id as string;

  const itens = Array.isArray(body.itens) ? body.itens : [];
  if (itens.length === 0 || itens.length > 200) {
    return Response.json({ error: "Nenhum item para aplicar." }, { status: 400 });
  }

  const parsed: { id: string; custo: number; estoque: number | null }[] = [];
  for (const it of itens) {
    const custo = Number(it.custo_unitario);
    const estoque = it.estoque_final === null || it.estoque_final === undefined || it.estoque_final === "" ? null : Number(it.estoque_final);
    if (typeof it.produto_id !== "string" || !Number.isFinite(custo) || custo < 0 || custo > 100000) {
      return Response.json({ error: "Tem item com custo inválido. Confira os números." }, { status: 400 });
    }
    if (estoque !== null && (!Number.isFinite(estoque) || estoque < 0 || estoque > 1000000)) {
      return Response.json({ error: "Tem item com estoque inválido. Confira os números." }, { status: 400 });
    }
    parsed.push({ id: it.produto_id, custo: Math.round(custo * 100) / 100, estoque: estoque === null ? null : Math.round(estoque * 1000) / 1000 });
  }
  if (new Set(parsed.map((p) => p.id)).size !== parsed.length) {
    return Response.json({ error: "O mesmo produto aparece duas vezes. Deixe só uma linha para cada." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // A mesma nota aplicada duas vezes soma o estoque duas vezes. Se já foi
  // aplicada, avisa e só segue se o dono confirmar (repetir: true).
  const numeroLimpo = String(body.numero ?? "").replace(/[^A-Za-z0-9.-/]/g, "");
  if (numeroLimpo && !body.repetir) {
    const { data: antes } = await admin
      .from("assistant_messages")
      .select("created_at")
      .eq("store_id", storeId)
      .eq("role", "assistant")
      .ilike("content", `%Apliquei a leitura da%nota ${numeroLimpo}:%`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (antes && antes.length > 0) {
      return Response.json(
        {
          error: `A nota ${numeroLimpo} já foi aplicada em ${new Date(antes[0].created_at).toLocaleDateString("pt-BR")}. Aplicar de novo soma o estoque outra vez.`,
          ja_aplicada: true,
        },
        { status: 409 },
      );
    }
  }

  const { data: owned } = await admin.from("products").select("id, name").eq("store_id", storeId).in("id", parsed.map((p) => p.id));
  const nameById = new Map((owned ?? []).map((p) => [p.id as string, p.name as string]));
  if (nameById.size !== parsed.length) {
    return Response.json({ error: "Tem produto que não é da sua loja." }, { status: 403 });
  }

  const falhas: string[] = [];
  let aplicados = 0;
  for (const p of parsed) {
    const update: Record<string, number> = { cost_price: p.custo };
    if (p.estoque !== null) update.stock = p.estoque;
    const { error } = await admin.from("products").update(update).eq("id", p.id).eq("store_id", storeId);
    if (error) falhas.push(nameById.get(p.id) ?? p.id);
    else aplicados++;
  }

  const origem = [body.fornecedor, numeroLimpo ? `nota ${numeroLimpo}` : null].filter(Boolean).join(" · ") || "nota fiscal";
  await admin.from("assistant_messages").insert({
    store_id: storeId,
    role: "assistant",
    content: `📷 Apliquei a leitura da ${origem}: ${aplicados} produto${aplicados === 1 ? "" : "s"} com custo e estoque atualizados${
      falhas.length ? `. Não consegui atualizar: ${falhas.join(", ")}.` : "."
    }`,
  });

  return Response.json({ aplicados, falhas });
}
