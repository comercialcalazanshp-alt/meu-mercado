// Verificação da migração v126 (venda offline no PDV).
// Rodar: node --env-file=.env.local test-pdv-offline-v126.mjs
//
// Usa a Loja Teste Visual (não mexe na loja real). Cria um produto de
// teste com estoque 1, vende 5 unidades com p_allow_negative_stock=true
// (simulando uma sincronização offline) e confere que:
//   1. A venda é aceita mesmo sem estoque suficiente
//   2. Volta stock_conflict = true
//   3. O estoque realmente fica negativo (-4)
// Limpa tudo no final.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TEST_STORE_ID = "1f526fb0-2c92-4a0a-a2ad-b920d68a6170";
const TEST_EMAIL = "teste-visual-1787915414527@meumercado.app";
const TEST_PASSWORD = "BHRtBnlxH6t2!1";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const owner = createClient(SUPABASE_URL, ANON_KEY);
const { error: signInErr } = await owner.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
if (signInErr) {
  console.error("Falhou login de teste:", signInErr.message);
  process.exit(1);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "OK" : "FALHOU"} - ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { data: product, error: insErr } = await admin
    .from("products")
    .insert({ store_id: TEST_STORE_ID, name: "TESTE OFFLINE (apagar)", price: 10, stock: 1, active: true })
    .select("id")
    .single();
  if (insErr) {
    check("cria produto de teste", false, insErr.message);
    process.exit(1);
  }

  const { data, error } = await owner.rpc("pdv_sale", {
    p_store_id: TEST_STORE_ID,
    p_items: [{ product_id: product.id, quantity: 5 }],
    p_payment_method: "dinheiro",
    p_allow_negative_stock: true,
  });

  check("venda offline é aceita mesmo com estoque insuficiente", !error && data?.length > 0, error?.message);
  check("volta stock_conflict = true", data?.[0]?.stock_conflict === true);

  const { data: after } = await admin.from("products").select("stock").eq("id", product.id).single();
  check("estoque real ficou -4 (1 - 5)", after?.stock === -4, `stock=${after?.stock}`);

  // Confirma que uma venda NORMAL (sem o flag) continua bloqueando estoque insuficiente, como sempre bloqueou.
  const { error: normalError } = await owner.rpc("pdv_sale", {
    p_store_id: TEST_STORE_ID,
    p_items: [{ product_id: product.id, quantity: 1 }],
    p_payment_method: "dinheiro",
  });
  check("venda normal (online) continua bloqueando estoque insuficiente", !!normalError, normalError ? "bloqueou certinho" : "não bloqueou!");

  await admin.from("orders").delete().eq("store_id", TEST_STORE_ID).eq("customer_name", "Cliente balcão");
  await admin.from("products").delete().eq("id", product.id);

  console.log("\n" + (failures === 0 ? "TUDO OK." : `${failures} verificação(ões) falharam.`));
  process.exit(failures === 0 ? 0 : 1);
}

main();
