// Testa o checkout() de ponta a ponta depois da mudança de v77 (tempo
// estimado de entrega por bairro), pra garantir que nada quebrou na função
// crítica de pagamento: pedido com bairro (eta preenchida), pedido sem
// bairro/retirada (eta null), e get_order_receipt devolvendo tudo certo.
// Roda: node --env-file=.env.local test-delivery-eta.mjs
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const results = [];
function ok(l) { results.push([l, true]); console.log("✅", l); }
function fail(l, d) { results.push([l, false]); console.log("❌", l, "—", d); }

const MARK = "teste-eta";
let storeId, productId, neighborhoodId, orderWithEtaId, orderRetiradaId;

async function main() {
  const { data: owner, error: ownerErr } = await admin.auth.admin.createUser({
    email: `${MARK}-dono-${Date.now()}@example.com`, password: "Teste123!" + Math.random(), email_confirm: true,
  });
  if (ownerErr) throw ownerErr;

  const { data: store, error: storeErr } = await admin.from("stores")
    .insert({ owner_id: owner.user.id, slug: `${MARK}-${Date.now()}`, name: "Loja Teste ETA" })
    .select("id").single();
  if (storeErr) throw storeErr;
  storeId = store.id;
  ok("cria loja de teste");

  const { data: product, error: prodErr } = await admin.from("products")
    .insert({ store_id: storeId, name: "Produto Teste ETA", price: 10, stock: 100, active: true })
    .select("id").single();
  if (prodErr) throw prodErr;
  productId = product.id;

  const { data: neighborhood, error: nErr } = await admin.from("neighborhoods")
    .insert({ store_id: storeId, name: "Bairro Teste", fee: 5, active: true, eta_min_minutes: 30, eta_max_minutes: 45 })
    .select("id").single();
  if (nErr) throw nErr;
  neighborhoodId = neighborhood.id;
  ok("cadastra bairro com estimativa 30-45 min");

  // checkout COM bairro
  const { data: withEta, error: err1 } = await anon.rpc("checkout", {
    p_store_id: storeId,
    p_customer_name: "Cliente Teste",
    p_customer_phone: "11999990001",
    p_items: [{ product_id: productId, quantity: 2 }],
    p_neighborhood_id: neighborhoodId,
    p_delivery_address: "Rua Teste, 123",
  });
  if (err1) return fail("checkout com bairro (eta)", err1.message);
  const r1 = withEta[0];
  if (r1.delivery_fee !== 5) return fail("checkout com bairro: delivery_fee", `veio ${r1.delivery_fee}`);
  if (r1.total !== 25) return fail("checkout com bairro: total (20 + 5 frete)", `veio ${r1.total}`);
  if (r1.eta_min_minutes === 30 && r1.eta_max_minutes === 45) ok("checkout com bairro devolve eta_min/eta_max corretos (30/45)");
  else fail("checkout com bairro devolve eta_min/eta_max corretos", JSON.stringify(r1));
  orderWithEtaId = r1.order_id;

  const { data: orderRow } = await admin.from("orders").select("eta_min_minutes, eta_max_minutes, delivery_fee").eq("id", orderWithEtaId).single();
  if (orderRow.eta_min_minutes === 30 && orderRow.eta_max_minutes === 45) ok("eta fica gravada (fotografada) na linha do pedido");
  else fail("eta gravada na linha do pedido", JSON.stringify(orderRow));

  // checkout SEM bairro (retirada) — eta deve vir null, nada deve quebrar
  const { data: noEta, error: err2 } = await anon.rpc("checkout", {
    p_store_id: storeId,
    p_customer_name: "Cliente Retirada",
    p_customer_phone: "11999990002",
    p_items: [{ product_id: productId, quantity: 1 }],
  });
  if (err2) return fail("checkout sem bairro (retirada)", err2.message);
  const r2 = noEta[0];
  if (r2.total === 10 && r2.eta_min_minutes === null && r2.eta_max_minutes === null) ok("checkout sem bairro (retirada) funciona normal, eta null");
  else fail("checkout sem bairro (retirada)", JSON.stringify(r2));
  orderRetiradaId = r2.order_id;

  // get_order_receipt devolve tudo, inclusive out_for_delivery_at (null, ainda não saiu)
  const { data: receipt, error: err3 } = await anon.rpc("get_order_receipt", { p_order_id: orderWithEtaId });
  if (err3) return fail("get_order_receipt", err3.message);
  const rec = receipt[0];
  if (rec.eta_min_minutes === 30 && rec.eta_max_minutes === 45 && rec.out_for_delivery_at === null) {
    ok("get_order_receipt devolve eta + out_for_delivery_at (null antes de sair pra entrega)");
  } else {
    fail("get_order_receipt devolve eta + out_for_delivery_at", JSON.stringify(rec));
  }

  // simula "saiu pra entrega" e confere que o horário aparece
  await admin.from("orders").update({ status: "entregando", out_for_delivery_at: new Date().toISOString() }).eq("id", orderWithEtaId);
  const { data: receipt2 } = await anon.rpc("get_order_receipt", { p_order_id: orderWithEtaId });
  if (receipt2[0].out_for_delivery_at) ok("get_order_receipt reflete out_for_delivery_at depois de marcar 'saiu pra entrega'");
  else fail("get_order_receipt reflete out_for_delivery_at", "veio null");

  console.log("\nResumo:", results.filter((r) => r[1]).length, "de", results.length, "passaram.");
}

async function cleanup() {
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  const { data: list } = await admin.auth.admin.listUsers();
  const testUsers = list.users.filter((u) => u.email?.startsWith(MARK));
  for (const u of testUsers) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  console.log("Limpo.");
}

main().catch((e) => console.error("Erro inesperado:", e)).finally(cleanup);
