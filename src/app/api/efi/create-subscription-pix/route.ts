import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isValidCPF } from "@/lib/cpf";
import { createEfiPixCharge, makeTxid } from "@/lib/efi-pix";

// Igual /api/pagbank/create-subscription-pix, gerando via Efí.
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { partnership_id } = (await request.json()) as { partnership_id?: string };
  if (!partnership_id) {
    return Response.json({ error: "partnership_id é obrigatório" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: partnership } = await scoped
    .from("affiliate_partnerships")
    .select("id, owner_name, tax_id, subscription_price, billing_cycle, active")
    .eq("id", partnership_id)
    .maybeSingle();

  if (!partnership) {
    return Response.json({ error: "Parceria não encontrada" }, { status: 404 });
  }
  if (!partnership.active) {
    return Response.json({ error: "Parceria inativa" }, { status: 400 });
  }
  if (!partnership.subscription_price || partnership.subscription_price <= 0) {
    return Response.json({ error: "Essa parceria não tem mensalidade configurada" }, { status: 400 });
  }

  const taxIdDigits = (partnership.tax_id || "").replace(/\D/g, "");
  if (taxIdDigits.length !== 11 && taxIdDigits.length !== 14) {
    return Response.json({ error: "CPF/CNPJ cadastrado é inválido" }, { status: 400 });
  }
  if (taxIdDigits.length === 11 && !isValidCPF(taxIdDigits)) {
    return Response.json({ error: "CPF cadastrado é inválido" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: charge, error: insertError } = await admin
    .from("affiliate_subscription_payments")
    .insert({
      partnership_id: partnership.id,
      amount: partnership.subscription_price,
      billing_cycle: partnership.billing_cycle,
    })
    .select("id")
    .single();

  if (insertError || !charge) {
    return Response.json({ error: "Não deu pra registrar a cobrança" }, { status: 500 });
  }

  try {
    const efiCharge = await createEfiPixCharge({
      txid: makeTxid(charge.id),
      amount: Number(partnership.subscription_price),
      customerName: partnership.owner_name || "Afiliado",
      customerTaxId: taxIdDigits,
      description: "Mensalidade Meu Mercado",
    });

    await admin.from("affiliate_subscription_payments").update({ pagbank_order_id: efiCharge.txid }).eq("id", charge.id);

    return Response.json({ qr_code_text: efiCharge.qrCodeText, qr_code_image: efiCharge.qrCodeImage });
  } catch (err) {
    console.error("Efí create-subscription-pix failed:", err instanceof Error ? err.message : err, (err as { body?: unknown })?.body);
    return Response.json({ error: "Não deu pra gerar o Pix" }, { status: 502 });
  }
}
