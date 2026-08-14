import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Login de cliente com bloqueio de verdade após 3 senhas erradas — não é só
// um contador na tela, o usuário do Auth é banido de verdade (ban_duration)
// via Admin API, então mesmo uma chamada direta na API do Supabase (sem
// passar por essa rota) continuaria bloqueada. Por isso o login de cliente
// precisa passar por aqui (servidor) em vez de chamar signInWithPassword
// direto do navegador como o painel do dono faz.
const MAX_ATTEMPTS = 3;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Preencha e-mail e senha." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: attemptRow } = await admin
    .from("customer_login_attempts")
    .select("failed_count, locked")
    .eq("email", email)
    .maybeSingle();

  if (attemptRow?.locked) {
    return NextResponse.json(
      {
        error:
          "Conta bloqueada por segurança depois de várias senhas erradas. Use 'Esqueci minha senha' pra criar uma nova, ou peça ajuda direto à loja.",
        locked: true,
      },
      { status: 423 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const authClient = createClient(supabaseUrl, anonKey);

  const { data, error } = await authClient.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    const nextCount = (attemptRow?.failed_count ?? 0) + 1;
    const lockingNow = nextCount >= MAX_ATTEMPTS;

    await admin.from("customer_login_attempts").upsert({
      email,
      failed_count: nextCount,
      locked: lockingNow,
      updated_at: new Date().toISOString(),
    });

    if (lockingNow) {
      const { data: profile } = await admin
        .from("customer_profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (profile) {
        await admin.auth.admin.updateUserById(profile.id, { ban_duration: "876000h" });
      }
      return NextResponse.json(
        {
          error:
            "Conta bloqueada por segurança depois de 3 senhas erradas. Use 'Esqueci minha senha' pra criar uma nova, ou peça ajuda direto à loja.",
          locked: true,
        },
        { status: 423 },
      );
    }

    return NextResponse.json(
      {
        error: `E-mail ou senha incorretos. Mais ${MAX_ATTEMPTS - nextCount} tentativa(s) antes do bloqueio.`,
      },
      { status: 401 },
    );
  }

  if (attemptRow && (attemptRow.failed_count > 0 || attemptRow.locked)) {
    await admin
      .from("customer_login_attempts")
      .update({ failed_count: 0, locked: false, updated_at: new Date().toISOString() })
      .eq("email", email);
  }

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
