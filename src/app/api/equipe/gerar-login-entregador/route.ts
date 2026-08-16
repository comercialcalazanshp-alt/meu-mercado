import "server-only";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Sem caracteres ambíguos (0/O, 1/l/I) — mais fácil de repassar por
// WhatsApp/verbalmente sem confusão na hora de digitar.
const SENHA_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";

function gerarSenha(tamanho = 8) {
  let senha = "";
  for (let i = 0; i < tamanho; i++) senha += SENHA_CHARS[randomInt(SENHA_CHARS.length)];
  return senha;
}

// Só o dono de verdade da loja pode chamar isso (a policy de store_members
// já restringe a select/update a auth.uid() = stores.owner_id — usamos o
// token de quem chamou pra confirmar isso antes de qualquer coisa, e só
// depois usamos a service role pra mexer no Supabase Auth, que exige
// privilégio elevado).
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { storeMemberId } = (await request.json()) as { storeMemberId?: string };
  if (!storeMemberId) {
    return Response.json({ error: "Faltou o id do entregador" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: member, error: memberError } = await scoped
    .from("store_members")
    .select("id, email, role, terms_accepted_at")
    .eq("id", storeMemberId)
    .single();

  if (memberError || !member) {
    return Response.json({ error: "Não autorizado" }, { status: 403 });
  }
  if (member.role !== "entregador") {
    return Response.json({ error: "Esse membro não é um entregador" }, { status: 400 });
  }
  if (!member.terms_accepted_at) {
    return Response.json({ error: "Ele ainda não confirmou o termo de condições" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const senha = gerarSenha();

  const { error: createError } = await admin.auth.admin.createUser({
    email: member.email,
    password: senha,
    email_confirm: true,
  });

  if (createError) {
    const jaExiste = /already.*registered|already.*exists/i.test(createError.message);
    if (!jaExiste) {
      return Response.json({ error: "Não deu pra criar o acesso: " + createError.message }, { status: 500 });
    }
    // Login já existe (ex: dono clicou em "gerar nova senha") — reseta em vez de recriar.
    const { data: usersPage, error: listError } = await admin.auth.admin.listUsers();
    const existing = usersPage?.users.find((u) => u.email?.toLowerCase() === member.email?.toLowerCase());
    if (listError || !existing) {
      return Response.json({ error: "Não deu pra localizar o login existente" }, { status: 500 });
    }
    const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password: senha });
    if (updateError) {
      return Response.json({ error: "Não deu pra gerar nova senha: " + updateError.message }, { status: 500 });
    }
  }

  return Response.json({ email: member.email, senha });
}
