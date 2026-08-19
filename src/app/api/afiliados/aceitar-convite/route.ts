import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { slugify } from "@/lib/slugify";

const BILLING_DAYS: Record<string, number> = { mensal: 30, trimestral: 90, semestral: 180, anual: 365 };

// Aceita um convite de afiliado: cria a conta de verdade (e-mail/senha
// escolhidos pela própria pessoa — diferente do entregador, que usa
// e-mail sintético gerado pelo dono, porque afiliado é dono de loja e
// precisa de login que ele mesmo controla), a loja (via o gatilho que já
// existe em auth.users — handle_new_store_owner, schema-v33) e a parceria,
// tudo numa chamada só. O convite guarda os termos (comissão, categoria
// etc.) definidos pelo Hub ANTES — a pessoa só confirma, não escolhe.
export async function POST(request: Request) {
  const { invite_id, email, password } = (await request.json()) as {
    invite_id?: string;
    email?: string;
    password?: string;
  };

  if (!invite_id || !email?.trim() || !password) {
    return Response.json({ error: "Faltou e-mail ou senha" }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ error: "Senha precisa ter pelo menos 6 caracteres" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: invite } = await admin
    .from("affiliate_invites")
    .select("*")
    .eq("id", invite_id)
    .eq("status", "pendente")
    .maybeSingle();

  if (!invite) {
    return Response.json({ error: "Convite não encontrado ou já usado" }, { status: 404 });
  }

  const baseSlug = slugify(invite.suggested_store_name) || "loja";

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: {
      store_name: invite.suggested_store_name,
      store_slug: baseSlug,
      whatsapp: invite.whatsapp,
    },
  });

  if (createError || !created.user) {
    const jaExiste = /already.*registered|already.*exists/i.test(createError?.message ?? "");
    return Response.json(
      { error: jaExiste ? "Já existe uma conta com esse e-mail — use outro ou entre normalmente." : "Não deu pra criar a conta: " + createError?.message },
      { status: 400 },
    );
  }

  // O gatilho handle_new_store_owner (schema-v33) cria a loja sozinho
  // assim que o usuário é inserido em auth.users — busca ela pelo dono.
  const { data: newStore } = await admin.from("stores").select("id").eq("owner_id", created.user.id).maybeSingle();
  if (!newStore) {
    return Response.json({ error: "A conta foi criada, mas a loja não — fale com o suporte." }, { status: 500 });
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (BILLING_DAYS[invite.billing_cycle] ?? 30));

  const { data: partnership, error: partnershipError } = await admin
    .from("affiliate_partnerships")
    .insert({
      hub_store_id: invite.hub_store_id,
      module_store_id: newStore.id,
      category: invite.category,
      owner_name: invite.owner_name,
      tax_id: invite.tax_id,
      address: invite.address,
      commission_percent: invite.commission_percent,
      payout_method: invite.payout_method,
      payout_speed: invite.payout_method === "manual" ? invite.payout_speed : null,
      plan_type: invite.plan_type,
      billing_cycle: invite.billing_cycle,
      subscription_price: invite.subscription_price,
      subscription_due_at: dueDate.toISOString(),
    })
    .select("id")
    .single();

  if (partnershipError || !partnership) {
    return Response.json(
      {
        error:
          partnershipError?.code === "23505"
            ? "Já existe um afiliado ativo com essa categoria nesse Hub."
            : "Loja criada, mas não deu pra ligar como afiliada: " + partnershipError?.message,
      },
      { status: 500 },
    );
  }

  await admin
    .from("affiliate_invites")
    .update({ status: "aceito", accepted_at: new Date().toISOString(), partnership_id: partnership.id })
    .eq("id", invite_id);

  return Response.json({ ok: true });
}
