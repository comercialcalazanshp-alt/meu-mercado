import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Rota pública (sem login) — é a página de aceite do termo que o entregador
// abre pelo link mandado no WhatsApp. Só grava a confirmação (não cria
// login/senha aqui) — quem gera o acesso depois é o dono, em
// /api/equipe/gerar-login-entregador.
export async function POST(request: Request) {
  const { id, confirmacao } = (await request.json()) as { id?: string; confirmacao?: string };

  if (!id) {
    return Response.json({ error: "Convite inválido." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: member, error } = await admin
    .from("store_members")
    .select("id, role, full_name, terms_accepted_at")
    .eq("id", id)
    .eq("role", "entregador")
    .maybeSingle();

  if (error || !member) {
    return Response.json({ error: "Convite não encontrado." }, { status: 404 });
  }

  if (member.terms_accepted_at) {
    return Response.json({ ok: true, fullName: member.full_name, jaConfirmado: true });
  }

  if ((confirmacao ?? "").trim().toUpperCase() !== "SIM") {
    return Response.json({ error: "Digite SIM pra confirmar que leu e concorda." }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("store_members")
    .update({ terms_accepted_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) {
    return Response.json({ error: "Não deu pra confirmar: " + updateError.message }, { status: 500 });
  }

  return Response.json({ ok: true, fullName: member.full_name, jaConfirmado: false });
}
