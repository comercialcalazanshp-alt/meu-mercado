"use server";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// "Esqueci minha senha" precisa passar pelo servidor em vez de chamar
// resetPasswordForEmail direto do navegador: se a conta estiver banida
// (bloqueada depois de 3 senhas erradas), o Supabase rejeita a verificação
// do link de recuperação também ("user_banned") — banimento bloqueia TODO
// tipo de login, inclusive recovery. Sem isso, "esqueci minha senha" vira
// um beco sem saída pra quem está bloqueado, e só o reset manual do dono
// (painel/cashback) funcionaria. Por isso desbanimos primeiro, aqui, antes
// de mandar o e-mail.
export async function requestCustomerPasswordReset(
  email: string,
  redirectTo: string,
): Promise<{ error?: string }> {
  const admin = getSupabaseAdmin();
  const cleanEmail = email.trim().toLowerCase();

  const { data: profile } = await admin
    .from("customer_profiles")
    .select("id")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (profile) {
    await admin.auth.admin.updateUserById(profile.id, { ban_duration: "none" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const authClient = createClient(supabaseUrl, anonKey);

  const { error } = await authClient.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
  if (error) {
    return { error: error.message };
  }

  return {};
}

// Chamado depois que o cliente redefine a própria senha com sucesso (link de
// "esqueci minha senha") — limpa o contador de tentativas erradas e
// desbane a conta, caso ela tivesse sido bloqueada antes.
export async function clearCustomerLockout(accessToken: string): Promise<{ error?: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const authClient = createClient(supabaseUrl, anonKey);

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(accessToken);

  if (userError || !user || !user.email) {
    return { error: "Sessão inválida." };
  }

  const admin = getSupabaseAdmin();
  await admin.auth.admin.updateUserById(user.id, { ban_duration: "none" });
  await admin
    .from("customer_login_attempts")
    .update({ failed_count: 0, locked: false, updated_at: new Date().toISOString() })
    .eq("email", user.email.toLowerCase());

  return {};
}
