"use server";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Recebe o token de acesso da sessão do navegador e confirma com o próprio
// Supabase Auth quem é o dono desse token — nunca confiamos num ID de
// usuário mandado direto pelo cliente, sempre validamos o token primeiro.
export async function deleteMyAccount(accessToken: string): Promise<{ error?: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const authClient = createClient(supabaseUrl, anonKey);

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(accessToken);

  if (userError || !user) {
    return { error: "Sessão inválida. Entre novamente e tente de novo." };
  }

  // Apaga a conta no Auth — a loja (e produtos, pedidos, cupons, etc.) some
  // junto por causa do "on delete cascade" em stores.owner_id.
  const { error: deleteError } = await getSupabaseAdmin().auth.admin.deleteUser(user.id);

  if (deleteError) {
    return { error: "Não deu pra apagar a conta: " + deleteError.message };
  }

  return {};
}
