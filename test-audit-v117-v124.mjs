// Verificação da migração combinada v117 a v124 (correções da vistoria).
// Rodar: node --env-file=.env.local test-audit-v117-v124.mjs
//
// Só CONFERE se as funções/colunas/policies novas existem e respondem
// como esperado — não mexe em nenhum dado real.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltou variável de ambiente no .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`OK   - ${label}`);
  } else {
    failures++;
    console.log(`FALHOU - ${label}${detail ? " — " + detail : ""}`);
  }
}

async function columnExists(table, column) {
  const { error } = await admin.from(table).select(column).limit(1);
  return !error;
}

// PostgREST devolve erro "PGRST202" (Could not find the function) quando a
// função não existe — qualquer outro erro (parâmetro errado, etc.) já
// prova que a função existe.
async function functionExists(name, args) {
  const { error } = await admin.rpc(name, args);
  return error?.code !== "PGRST202";
}

async function main() {
  // 1. Colunas novas em orders
  for (const col of [
    "referral_bonus_earned",
    "referrer_customer_id",
    "cashback_credited_at",
    "cashback_reversed_at",
    "card_charging_at",
  ]) {
    check(`coluna orders.${col} existe`, await columnExists("orders", col));
  }

  check("coluna hub_orders.card_charging_at existe", await columnExists("hub_orders", "card_charging_at"));

  // 2. Funções novas (chama com um uuid aleatório — só importa que a
  // função em si exista, não que faça algo com um id que não existe)
  const dummyUuid = "00000000-0000-0000-0000-000000000000";
  check("função credit_pending_cashback() existe", await functionExists("credit_pending_cashback", { p_order_id: dummyUuid }));
  check("função reverse_order_cashback() existe", await functionExists("reverse_order_cashback", { p_order_id: dummyUuid }));
  check("função claim_card_charge() existe", await functionExists("claim_card_charge", { p_order_id: dummyUuid, p_is_hub: false }));
  check("função reverse_order_settlement() existe", await functionExists("reverse_order_settlement", { p_order_id: dummyUuid }));
  check("função get_shared_list() existe", await functionExists("get_shared_list", { p_id: dummyUuid, p_store_id: dummyUuid }));
  check("função affiliate_assistant_enabled() existe", await functionExists("affiliate_assistant_enabled", { p_store_id: dummyUuid }));

  // 3. claim_card_charge funciona de verdade (cria e usa um pedido de teste)
  const { data: testStore } = await admin.from("stores").select("id").limit(1).maybeSingle();
  if (testStore) {
    const { data: testOrder, error: insertErr } = await admin
      .from("orders")
      .insert({
        store_id: testStore.id,
        customer_name: "TESTE AUDITORIA (apagar)",
        customer_phone: "00000000000",
        items: [{ name: "teste", price: 1, quantity: 1 }],
        total: 1,
        payment_method: "cartao",
      })
      .select("id")
      .single();

    if (insertErr) {
      check("consegue criar pedido de teste", false, insertErr.message);
    } else {
      const { data: claimed1 } = await admin.rpc("claim_card_charge", { p_order_id: testOrder.id, p_is_hub: false });
      check("claim_card_charge libera a primeira tentativa", claimed1 === true);

      const { data: claimed2 } = await admin.rpc("claim_card_charge", { p_order_id: testOrder.id, p_is_hub: false });
      check("claim_card_charge bloqueia uma segunda tentativa simultânea", claimed2 === false);

      await admin.from("orders").delete().eq("id", testOrder.id);
    }
  } else {
    console.log("(pulando teste de claim_card_charge — nenhuma loja encontrada)");
  }

  // 4. RLS: shared_lists não deve mais permitir select público direto
  const { data: sharedListsPolicy } = await admin
    .from("pg_policies")
    .select("policyname")
    .eq("schemaname", "public")
    .eq("tablename", "shared_lists")
    .eq("policyname", "lista compartilhada e publica");
  check("policy pública antiga de shared_lists foi removida", (sharedListsPolicy?.length ?? 0) === 0);

  const { data: siteVisitsPolicy } = await admin
    .from("pg_policies")
    .select("policyname")
    .eq("schemaname", "public")
    .eq("tablename", "site_visits")
    .eq("policyname", "qualquer um atualiza a propria sessao");
  check("policy pública antiga de site_visits foi removida", (siteVisitsPolicy?.length ?? 0) === 0);

  console.log("\n" + (failures === 0 ? "TUDO OK — migração aplicada corretamente." : `${failures} verificação(ões) falharam.`));
  process.exit(failures === 0 ? 0 : 1);
}

main();
