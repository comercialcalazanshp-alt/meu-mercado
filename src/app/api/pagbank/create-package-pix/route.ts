import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isValidCPF } from "@/lib/cpf";

// Gera o Pix de um pacote extra de imagem por IA — mesma ideia da
// mensalidade (create-subscription-pix): valor e quantidade vêm sempre do
// pacote gravado no servidor (affiliate_ai_packages), nunca do navegador.
export async function POST(request: Request) {
  const token = process.env.PAGBANK_TOKEN;
  if (!token) {
    return Response.json({ error: "Pagamento Pix não configurado" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { partnership_id, package_id } = (await request.json()) as {
    partnership_id?: string;
    package_id?: string;
  };
  if (!partnership_id || !package_id) {
    return Response.json({ error: "partnership_id e package_id são obrigatórios" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: partnership } = await scoped
    .from("affiliate_partnerships")
    .select("id, owner_name, tax_id, active")
    .eq("id", partnership_id)
    .maybeSingle();
  if (!partnership) {
    return Response.json({ error: "Parceria não encontrada" }, { status: 404 });
  }
  if (!partnership.active) {
    return Response.json({ error: "Parceria inativa" }, { status: 400 });
  }

  const { data: pkg } = await scoped
    .from("affiliate_ai_packages")
    .select("id, qty, price, active")
    .eq("id", package_id)
    .maybeSingle();
  if (!pkg || !pkg.active) {
    return Response.json({ error: "Pacote não encontrado" }, { status: 404 });
  }

  const cpfDigits = (partnership.tax_id || "").replace(/\D/g, "");
  if (cpfDigits.length !== 11 && cpfDigits.length !== 14) {
    return Response.json({ error: "CPF/CNPJ cadastrado é inválido" }, { status: 400 });
  }
  if (cpfDigits.length === 11 && !isValidCPF(cpfDigits)) {
    return Response.json({ error: "CPF cadastrado é inválido" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: purchase, error: insertError } = await admin
    .from("affiliate_ai_purchases")
    .insert({
      partnership_id: partnership.id,
      package_id: pkg.id,
      image_qty: pkg.qty,
      price: pkg.price,
      payment_method: "pix",
    })
    .select("id")
    .single();

  if (insertError || !purchase) {
    return Response.json({ error: "Não deu pra registrar a compra" }, { status: 500 });
  }

  const amountCents = Math.round(Number(pkg.price) * 100);

  const pagbankBody = {
    reference_id: purchase.id,
    customer: {
      name: partnership.owner_name || "Afiliado",
      email: `afiliado-${partnership.id}@meumercado.app`,
      tax_id: cpfDigits,
    },
    items: [{ name: `Pacote +${pkg.qty} imagens IA`, quantity: 1, unit_amount: amountCents }],
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
    console.error("PagBank create-package-pix failed:", pagbankRes.status, JSON.stringify(pagbankData));
    return Response.json({ error: "Não deu pra gerar o Pix", details: pagbankData }, { status: 502 });
  }

  const qrCode = pagbankData.qr_codes?.[0];
  const qrText = qrCode?.text ?? null;
  const qrImageLink = qrCode?.links?.find((l: { rel: string; href: string }) => l.rel === "QRCODE.PNG")?.href ?? null;

  await admin.from("affiliate_ai_purchases").update({ pagbank_order_id: pagbankData.id }).eq("id", purchase.id);

  return Response.json({ qr_code_text: qrText, qr_code_image: qrImageLink });
}
