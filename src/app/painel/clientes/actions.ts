"use server";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

async function assertOwnerAccess(ownerAccessToken: string, storeId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const authClient = createClient(supabaseUrl, anonKey);

  const {
    data: { user: owner },
    error: ownerError,
  } = await authClient.auth.getUser(ownerAccessToken);

  if (ownerError || !owner) {
    return { error: "Sessão inválida. Entre novamente e tente de novo." } as const;
  }

  const admin = getSupabaseAdmin();
  const { data: store } = await admin.from("stores").select("id, owner_id").eq("id", storeId).maybeSingle();
  let allowed = !!store && store.owner_id === owner.id;
  if (!allowed && owner.email) {
    const { data: member } = await admin
      .from("store_members")
      .select("id")
      .eq("store_id", storeId)
      .ilike("email", owner.email)
      .maybeSingle();
    allowed = !!member;
  }
  if (!allowed) {
    return { error: "Você não tem acesso a essa loja." } as const;
  }

  return { admin } as const;
}

// Dono manda um e-mail de redefinição de senha pro cliente, a partir do
// WhatsApp dele (o dono não precisa saber o e-mail do cliente) — pensado
// pra quando o cliente chama a loja no WhatsApp dizendo que não consegue
// mais entrar na própria conta. Também limpa qualquer bloqueio de 3
// tentativas erradas que a conta tivesse.
export async function resetCustomerAccess(
  ownerAccessToken: string,
  storeId: string,
  phone: string,
  origin: string,
): Promise<{ error?: string; ok?: boolean }> {
  const auth = await assertOwnerAccess(ownerAccessToken, storeId);
  if (auth.error) return { error: auth.error };
  const admin = auth.admin;

  const cleanPhone = phone.trim();
  const { data: customer } = await admin
    .from("customers")
    .select("profile_id")
    .eq("store_id", storeId)
    .eq("phone", cleanPhone)
    .maybeSingle();

  if (!customer?.profile_id) {
    return { error: "Esse cliente ainda não criou uma conta — não tem o que resetar." };
  }

  const { data: profile } = await admin
    .from("customer_profiles")
    .select("email")
    .eq("id", customer.profile_id)
    .maybeSingle();

  if (!profile?.email) {
    return { error: "Não encontrei a conta desse cliente." };
  }

  await admin.auth.admin.updateUserById(customer.profile_id, { ban_duration: "none" });
  await admin
    .from("customer_login_attempts")
    .update({ failed_count: 0, locked: false, updated_at: new Date().toISOString() })
    .eq("email", profile.email.toLowerCase());

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const authClient = createClient(supabaseUrl, anonKey);

  const { error: resetError } = await authClient.auth.resetPasswordForEmail(profile.email, {
    redirectTo: `${origin}/cliente/redefinir-senha`,
  });

  if (resetError) {
    return { error: "Não deu pra mandar o e-mail: " + resetError.message };
  }

  return { ok: true };
}
