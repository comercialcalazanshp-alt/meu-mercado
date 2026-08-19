import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isValidCPF } from "@/lib/cpf";

// Gera o Pix da mensalidade de um afiliado com o Hub — mesma integração
// PagBank já usada no checkout de cliente (create-pix), só que aqui quem
// paga é o afiliado e quem recebe é o Hub (dono da plataforma). O valor
// cobrado vem sempre de affiliate_partnerships.subscription_price gravado
// no servidor — nunca de algo que o navegador manda, senão daria pra pagar
// qualquer valor.
export async function POST(request: Request) {
  const token = process.env.PAGBANK_TOKEN;
  if (!token) {
    return Response.json({ error: "Pagamento Pix não configurado" }, { status: 500 });
  }

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

  // Só o próprio afiliado (dono da module_store_id) pode gerar a cobrança
  // da própria mensalidade — a policy de select em affiliate_partnerships
  // já restringe isso, então se a linha não vier é porque não é dele.
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

  const cpfDigits = (partnership.tax_id || "").replace(/\D/g, "");
  if (cpfDigits.length !== 11 && cpfDigits.length !== 14) {
    return Response.json({ error: "CPF/CNPJ cadastrado é inválido" }, { status: 400 });
  }
  if (cpfDigits.length === 11 && !isValidCPF(cpfDigits)) {
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

  const amountCents = Math.round(Number(partnership.subscription_price) * 100);

  const pagbankBody = {
    reference_id: charge.id,
    customer: {
      name: partnership.owner_name || "Afiliado",
      email: `afiliado-${partnership.id}@meumercado.app`,
      tax_id: cpfDigits,
    },
    items: [{ name: "Mensalidade Meu Mercado", quantity: 1, unit_amount: amountCents }],
    qr_codes: [{ amount: { value: amountCents }, arrangements: ["PAGBANK"] }],
    notification_urls: ["https://meu-mercado-blond.vercel.app/api/pagbank/webhook"],
  };

  const pagbankRes = await fetch("https://api.pagseguro.com/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(pagbankBody),
  });
  const pagbankData = await pagbankRes.json();

  if (!pagbankRes.ok) {
    console.error("PagBank create-subscription-pix failed:", pagbankRes.status, JSON.stringify(pagbankData));
    return Response.json({ error: "Não deu pra gerar o Pix", details: pagbankData }, { status: 502 });
  }

  const qrCode = pagbankData.qr_codes?.[0];
  const qrText = qrCode?.text ?? null;
  const qrImageLink = qrCode?.links?.find((l: { rel: string; href: string }) => l.rel === "QRCODE.PNG")?.href ?? null;

  await admin.from("affiliate_subscription_payments").update({ pagbank_order_id: pagbankData.id }).eq("id", charge.id);

  return Response.json({ qr_code_text: qrText, qr_code_image: qrImageLink });
}
