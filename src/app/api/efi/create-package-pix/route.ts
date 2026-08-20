import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isValidCPF } from "@/lib/cpf";
import { createEfiPixCharge, makeTxid } from "@/lib/efi-pix";

// Igual /api/pagbank/create-package-pix, gerando via Efí.
export async function POST(request: Request) {
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

  const taxIdDigits = (partnership.tax_id || "").replace(/\D/g, "");
  if (taxIdDigits.length !== 11 && taxIdDigits.length !== 14) {
    return Response.json({ error: "CPF/CNPJ cadastrado é inválido" }, { status: 400 });
  }
  if (taxIdDigits.length === 11 && !isValidCPF(taxIdDigits)) {
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

  try {
    const efiCharge = await createEfiPixCharge({
      txid: makeTxid(purchase.id),
      amount: Number(pkg.price),
      customerName: partnership.owner_name || "Afiliado",
      customerTaxId: taxIdDigits,
      description: `Pacote +${pkg.qty} imagens IA`,
    });

    await admin.from("affiliate_ai_purchases").update({ pagbank_order_id: efiCharge.txid }).eq("id", purchase.id);

    return Response.json({ qr_code_text: efiCharge.qrCodeText, qr_code_image: efiCharge.qrCodeImage });
  } catch (err) {
    console.error("Efí create-package-pix failed:", err instanceof Error ? err.message : err, (err as { body?: unknown })?.body);
    return Response.json({ error: "Não deu pra gerar o Pix" }, { status: 502 });
  }
}
