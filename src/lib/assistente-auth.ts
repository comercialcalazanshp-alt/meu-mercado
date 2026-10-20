import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Mesma checagem que o chat do assistente já faz (token do usuário, loja é
// dele, plano com assistente), mais uma: só o dono / acesso completo mexe em
// custo e estoque. "Só caixa" e "só entregas" nunca chegam aqui.
export async function authorizeFullAccess(
  request: Request,
  storeId: string | undefined,
): Promise<{ error: Response } | { scoped: SupabaseClient }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { error: Response.json({ error: "Não autenticado" }, { status: 401 }) };
  if (!storeId) return { error: Response.json({ error: "store_id é obrigatório" }, { status: 400 }) };

  const scoped = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: myStoreIds, error: idsError } = await scoped.rpc("my_store_ids");
  if (idsError || !myStoreIds?.some((id: string) => id === storeId)) {
    return { error: Response.json({ error: "Essa loja não é sua" }, { status: 403 }) };
  }

  const { data: role } = await scoped.rpc("get_my_role", { p_store_id: storeId });
  if (role !== "completo") {
    return { error: Response.json({ error: "Só quem tem acesso completo pode usar isso." }, { status: 403 }) };
  }

  const { data: enabled } = await scoped.rpc("affiliate_assistant_enabled", { p_store_id: storeId });
  if (!enabled) {
    return {
      error: Response.json(
        { error: "Esse recurso não está incluído no seu plano. Fala com quem administra o Hub pra liberar." },
        { status: 402 },
      ),
    };
  }

  return { scoped };
}
