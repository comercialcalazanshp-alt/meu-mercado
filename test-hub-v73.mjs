// Script de verificação da migração schema-v73.sql (Hub de Afiliados).
// Rodar SÓ depois de aplicar a migração no Supabase.
// Não precisa entender o código — só rodar:
//   node --env-file=.env.local test-hub-v73.mjs
//
// Testa, em ordem:
//   1. As tabelas novas existem
//   2. O gatilho de seed (affiliate_settings -> extras + pacotes de IA)
//   3. Exclusividade de categoria (índice único bloqueia duplicata)
//   4. O gatilho de saldo (venda soma, repasse desconta)
//   5. A função que bloqueia a cota de IA quando esgota (com usuário de
//      teste de verdade, porque essa função depende de quem está logado)
//
// Tudo criado aqui é loja de teste jogada fora — NUNCA toca na sua loja
// real (Comercial Calazans). Limpa no final, dê certo ou não (bloco
// finally), não deixa lixo no banco.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Faltou variável de ambiente no .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MARK = "teste-hub-v73";
const results = [];
function ok(label) { results.push({ label, pass: true }); console.log("✅", label); }
function fail(label, detail) { results.push({ label, pass: false, detail }); console.log("❌", label, "—", detail); }

let hubStoreId = null;
let moduleStoreId = null;
let extraModuleStoreId = null;
let testUserId = null;
const testEmail = `teste-hub-v73-${Date.now()}@example.com`;
const testPassword = "TesteHubV73!" + Math.random().toString(36).slice(2);

async function main() {
  // 0. Tabelas existem?
  const tables = [
    "affiliate_partnerships", "affiliate_settings", "affiliate_extras",
    "affiliate_partnership_extras", "affiliate_ai_packages",
    "affiliate_ai_image_events", "affiliate_ai_purchases",
    "affiliate_settlement_transactions", "affiliate_order_stops",
  ];
  for (const t of tables) {
    const { error } = await admin.from(t).select("id").limit(1);
    if (error) fail(`tabela ${t} existe`, error.message);
    else ok(`tabela ${t} existe`);
  }

  const { error: colErr } = await admin.from("orders").select("delivered_at").limit(1);
  if (colErr) fail("coluna orders.delivered_at existe", colErr.message);
  else ok("coluna orders.delivered_at existe");

  // 1. Usuário de teste — dono de todas as lojas fictícias criadas aqui
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email: testEmail, password: testPassword, email_confirm: true,
  });
  if (userErr) { fail("criar usuário de teste", userErr.message); return; }
  testUserId = userData.user.id;
  ok("criar usuário de teste");

  // 2. Duas lojas de mentira: uma vira o "hub", outra o "afiliado"
  const { data: hubStore, error: hubErr } = await admin.from("stores")
    .insert({ owner_id: testUserId, slug: `${MARK}-hub-${Date.now()}`, name: `${MARK} Hub` })
    .select("id").single();
  if (hubErr) { fail("criar loja de teste (hub)", hubErr.message); return; }
  hubStoreId = hubStore.id;

  const { data: moduleStore, error: modErr } = await admin.from("stores")
    .insert({ owner_id: testUserId, slug: `${MARK}-afiliado-${Date.now()}`, name: `${MARK} Padaria`, address: "Rua de Teste, 123", lat: -23.5, lng: -46.6 })
    .select("id").single();
  if (modErr) { fail("criar loja de teste (afiliado)", modErr.message); return; }
  moduleStoreId = moduleStore.id;
  ok("criar duas lojas de teste (hub + afiliado), nenhuma real envolvida");

  // 3. affiliate_settings -> dispara o seed de extras e pacotes de IA
  const { error: setErr } = await admin.from("affiliate_settings").insert({ hub_store_id: hubStoreId });
  if (setErr) { fail("criar affiliate_settings (gatilho de seed)", setErr.message); return; }

  const { data: extras } = await admin.from("affiliate_extras").select("code").eq("hub_store_id", hubStoreId);
  if (extras?.length === 7) ok("gatilho de seed criou os 7 extras");
  else fail("gatilho de seed criou os 7 extras", `veio ${extras?.length ?? 0}`);

  const { data: packages } = await admin.from("affiliate_ai_packages").select("qty").eq("hub_store_id", hubStoreId).is("partnership_id", null);
  if (packages?.length === 3) ok("gatilho de seed criou os 3 pacotes de IA (+5/+20/+30)");
  else fail("gatilho de seed criou os 3 pacotes de IA", `veio ${packages?.length ?? 0}`);

  // 4. Criar a parceria, com cota de IA baixa (2) pra testar o bloqueio rápido
  const { data: partnership, error: partErr } = await admin.from("affiliate_partnerships").insert({
    hub_store_id: hubStoreId, module_store_id: moduleStoreId,
    category: `${MARK}-categoria`, owner_name: "Dono de Teste",
    tax_id: "00000000000", address: "Rua de Teste, 123",
    ai_quota_monthly: 2,
  }).select("id").single();
  if (partErr) { fail("criar parceria de teste", partErr.message); return; }
  const partnershipId = partnership.id;
  ok("criar parceria de teste (categoria exclusiva, cota de IA = 2)");

  // 5. Exclusividade de categoria: uma segunda loja tentando a MESMA
  // categoria, no mesmo hub, deve ser recusada pelo índice único.
  const { data: extraStore } = await admin.from("stores")
    .insert({ owner_id: testUserId, slug: `${MARK}-afiliado2-${Date.now()}`, name: `${MARK} Padaria 2` })
    .select("id").single();
  extraModuleStoreId = extraStore.id;
  const { error: dupErr } = await admin.from("affiliate_partnerships").insert({
    hub_store_id: hubStoreId, module_store_id: extraModuleStoreId,
    category: `${MARK}-categoria`, owner_name: "Dono 2", tax_id: "00000000000", address: "Rua X",
  });
  if (dupErr) ok("categoria duplicada foi recusada (exclusividade funcionando)");
  else fail("categoria duplicada foi recusada", "inseriu sem erro — exclusividade não está funcionando");

  // 6. Gatilho de saldo (extrato de acerto)
  await admin.from("affiliate_settlement_transactions").insert({ partnership_id: partnershipId, type: "venda", amount: 100 });
  await admin.from("affiliate_settlement_transactions").insert({ partnership_id: partnershipId, type: "repasse", amount: 40 });
  const { data: afterTx } = await admin.from("affiliate_partnerships").select("balance").eq("id", partnershipId).single();
  if (Number(afterTx?.balance) === 60) ok("gatilho de saldo: venda +100, repasse -40 = 60 (correto)");
  else fail("gatilho de saldo", `esperava 60, veio ${afterTx?.balance}`);

  // 7. Logar como o usuário de teste e testar o bloqueio de cota de IA
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error: loginErr } = await client.auth.signInWithPassword({ email: testEmail, password: testPassword });
  if (loginErr) { fail("logar com usuário de teste", loginErr.message); }
  else {
    ok("logar com usuário de teste");
    const { error: gen1 } = await client.rpc("affiliate_generate_ai_image", { p_partnership_id: partnershipId, p_kind: "gerada" });
    const { error: gen2 } = await client.rpc("affiliate_generate_ai_image", { p_partnership_id: partnershipId, p_kind: "gerada" });
    const { error: gen3 } = await client.rpc("affiliate_generate_ai_image", { p_partnership_id: partnershipId, p_kind: "gerada" });
    if (!gen1 && !gen2) ok("gerou as 2 primeiras imagens (dentro da cota)");
    else fail("gerar as 2 primeiras imagens", gen1?.message || gen2?.message);
    if (gen3) ok("3ª imagem foi bloqueada corretamente (cota esgotada)");
    else fail("3ª imagem foi bloqueada", "deveria ter dado erro de cota esgotada e não deu");
  }

  console.log("\nResumo:", results.filter((r) => r.pass).length, "de", results.length, "passaram.");
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.log("\nFalharam:");
    for (const f of failed) console.log(" -", f.label, ":", f.detail);
  }
}

async function cleanup() {
  console.log("\nLimpando dados de teste...");
  // Deletar as lojas já cascateia partnerships/settlement/ai_events/stops
  // (todas têm "on delete cascade" pra store_id/module_store_id/hub_store_id).
  if (moduleStoreId) await admin.from("stores").delete().eq("id", moduleStoreId);
  if (extraModuleStoreId) await admin.from("stores").delete().eq("id", extraModuleStoreId);
  if (hubStoreId) {
    await admin.from("stores").delete().eq("id", hubStoreId);
  }
  if (testUserId) await admin.auth.admin.deleteUser(testUserId);
  console.log("Limpo.");
}

main().catch((e) => console.error("Erro inesperado:", e)).finally(cleanup);
