import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Remove o cadastro do entregador E o login gerado pra ele (se já tinha
// sido gerado) — sem isso, remover da equipe deixava o e-mail/senha
// continuar funcionando (só sem acesso a loja nenhuma, mas a conta
// seguia existindo). Só faz isso pra cargo "entregador" com e-mail
// interno (@entregador.meumercado.app), gerado só pra essa loja — nunca
// mexe no login de "completo"/"caixa", que é um e-mail de verdade da
// pessoa, possivelmente usado em outra loja também.
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { storeMemberId } = (await request.json()) as { storeMemberId?: string };
  if (!storeMemberId) {
    return Response.json({ error: "Faltou o id do membro" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: member, error: memberError } = await scoped
    .from("store_members")
    .select("id, email, role")
    .eq("id", storeMemberId)
    .single();

  if (memberError || !member) {
    return Response.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { error: deleteError } = await scoped.from("store_members").delete().eq("id", storeMemberId);
  if (deleteError) {
    return Response.json({ error: "Não deu pra remover: " + deleteError.message }, { status: 500 });
  }

  if (member.role === "entregador" && member.email?.endsWith("@entregador.meumercado.app")) {
    const admin = getSupabaseAdmin();
    const { data: usersPage } = await admin.auth.admin.listUsers();
    const authUser = usersPage?.users.find((u) => u.email?.toLowerCase() === member.email?.toLowerCase());
    if (authUser) await admin.auth.admin.deleteUser(authUser.id).catch(() => {});
  }

  return Response.json({ ok: true });
}
