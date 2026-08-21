import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isValidCPF } from "@/lib/cpf";
import { createEfiBoleto } from "@/lib/efi-cobrancas";

// Igual /api/efi/create-subscription-pix, mas gerando boleto — exige os
// dados de cobrança (billing_*) que o próprio afiliado preenche na tela
// de Parceria antes do primeiro boleto.
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
    .select(
      "id, owner_name, tax_id, subscription_price, billing_cycle, active, billing_email, billing_phone, billing_cep, billing_street, billing_number, billing_neighborhood, billing_city, billing_state, billing_complement",
    )
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
  if (
    !partnership.billing_email ||
    !partnership.billing_phone ||
    !partnership.billing_cep ||
    !partnership.billing_street ||
    !partnership.billing_number ||
    !partnership.billing_neighborhood ||
    !partnership.billing_city ||
    !partnership.billing_state
  ) {
    return Response.json({ error: "Preencha seus dados de cobrança antes de gerar o boleto" }, { status: 400 });
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
    const boleto = await createEfiBoleto({
      description: "Mensalidade Meu Mercado",
      amount: Number(partnership.subscription_price),
      expireInDays: 5,
      customer: {
        name: partnership.owner_name || "Afiliado",
        taxId: taxIdDigits,
        email: partnership.billing_email,
        phone: partnership.billing_phone.replace(/\D/g, ""),
        cep: partnership.billing_cep.replace(/\D/g, ""),
        street: partnership.billing_street,
        number: partnership.billing_number,
        neighborhood: partnership.billing_neighborhood,
        city: partnership.billing_city,
        state: partnership.billing_state,
        complement: partnership.billing_complement ?? undefined,
      },
    });

    await admin
      .from("affiliate_subscription_payments")
      .update({ pagbank_order_id: String(boleto.chargeId), boleto_barcode: boleto.barcode, boleto_pdf_url: boleto.pdfUrl, boleto_expire_at: boleto.expireAt })
      .eq("id", charge.id);

    return Response.json({ record_id: charge.id, barcode: boleto.barcode, pdf_url: boleto.pdfUrl, expire_at: boleto.expireAt });
  } catch (err) {
    console.error("Efí create-subscription-boleto failed:", err instanceof Error ? err.message : err, (err as { body?: unknown })?.body);
    return Response.json({ error: "Não deu pra gerar o boleto" }, { status: 502 });
  }
}
