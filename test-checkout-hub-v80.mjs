// Testa checkout_hub() isoladamente: hub + 1 afiliado, carrinho misto,
// confere pedidos separados, saldo do afiliado, checklist de retirada.
// node --env-file=.env.local test-checkout-hub-v80.mjs
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const MARK = "teste-hub-v80";
const results = [];
function ok(l) { results.push([l, true]); console.log("✅", l); }
function fail(l, d) { results.push([l, false]); console.log("❌", l, "—", d); }

let hubStoreId, hubOwnerId, affStoreId, affOwnerId, partnershipId, hubProductId, affProductId;

async function main() {
  // dono do hub
  const { data: hubOwner, error: hubOwnerErr } = await admin.auth.admin.createUser({
    email: `${MARK}-hub-${Date.now()}@example.com`, password: "Teste123!" + Math.random(), email_confirm: true,
  });
  if (hubOwnerErr) throw hubOwnerErr;
  hubOwnerId = hubOwner.user.id;
  const { data: hubStores } = await admin.from("stores").select("id, slug").eq("owner_id", hubOwnerId);
  hubStoreId = hubStores[0].id;
  await admin.from("stores").update({ name: "Hub Teste v80" }).eq("id", hubStoreId);
  ok("cria loja hub (reaproveitando a auto-criada)");

  // dono do afiliado
  const { data: affOwner, error: affOwnerErr } = await admin.auth.admin.createUser({
    email: `${MARK}-afiliado-${Date.now()}@example.com`, password: "Teste123!" + Math.random(), email_confirm: true,
  });
  if (affOwnerErr) throw affOwnerErr;
  affOwnerId = affOwner.user.id;
  const { data: affStores } = await admin.from("stores").select("id, slug").eq("owner_id", affOwnerId);
  affStoreId = affStores[0].id;
  await admin.from("stores").update({ name: "Padaria Teste v80" }).eq("id", affStoreId);
  ok("cria loja afiliada (reaproveitando a auto-criada)");

  // parceria: comissão do hub 20% -> afiliado fica com 80% da venda
  const { data: partnership, error: partnershipErr } = await admin.from("affiliate_partnerships").insert({
    hub_store_id: hubStoreId, module_store_id: affStoreId, category: "Padaria",
    owner_name: "Dono Padaria", tax_id: "00000000000", address: "Rua Teste, 123",
    commission_percent: 20, active: true,
  }).select("id").single();
  if (partnershipErr) throw partnershipErr;
  partnershipId = partnership.id;
  ok("cria parceria hub<->afiliado com comissão 20%");

  // produtos
  const { data: hubProduct, error: hubProdErr } = await admin.from("products").insert({
    store_id: hubStoreId, name: "Arroz 5kg", price: 20, stock: 10, stock_alert_threshold: 5, on_offer: false, offer_price: null,
  }).select("id").single();
  if (hubProdErr) throw hubProdErr;
  hubProductId = hubProduct.id;

  const { data: affProduct, error: affProdErr } = await admin.from("products").insert({
    store_id: affStoreId, name: "Pão Francês (kg)", price: 15, stock: 10, stock_alert_threshold: 5, on_offer: false, offer_price: null,
  }).select("id").single();
  if (affProdErr) throw affProdErr;
  affProductId = affProduct.id;
  ok("cria 1 produto no hub e 1 produto no afiliado");

  // 1) checkout_hub com carrinho misto (hub + afiliado)
  const carts = [
    { store_id: hubStoreId, items: [{ product_id: hubProductId, quantity: 1 }] },
    { store_id: affStoreId, items: [{ product_id: affProductId, quantity: 2 }] },
  ];
  const { data: checkoutResult, error: checkoutErr } = await anon.rpc("checkout_hub", {
    p_hub_store_id: hubStoreId, p_customer_name: "Cliente Hub Teste", p_customer_phone: "11900000099", p_carts: carts,
  });
  if (checkoutErr || !checkoutResult || checkoutResult.length !== 2) {
    fail("checkout_hub cria 2 pedidos (1 por loja)", checkoutErr?.message ?? JSON.stringify(checkoutResult));
  } else ok("checkout_hub cria 2 pedidos (1 por loja) num carrinho só");

  const hubOrderId = checkoutResult?.[0]?.hub_order_id;
  const hubLine = checkoutResult?.find((r) => r.store_id === hubStoreId);
  const affLine = checkoutResult?.find((r) => r.store_id === affStoreId);

  if (hubLine?.total === 20 && affLine?.total === 30) ok("total de cada pedido bate (R$20 hub, R$30 afiliado)");
  else fail("total de cada pedido deveria bater", JSON.stringify({ hubLine, affLine }));

  // 2) hub_orders.total combinado
  const { data: hubOrderRow } = await admin.from("hub_orders").select("total, hub_store_id, customer_name").eq("id", hubOrderId).single();
  if (hubOrderRow?.total === 50) ok("hub_orders.total combinado = R$50 (soma dos 2 pedidos)");
  else fail("hub_orders.total deveria ser 50", hubOrderRow?.total);

  // 3) cada order tem hub_order_id preenchido e aparece certinho no painel de cada loja
  const { data: hubOrders } = await admin.from("orders").select("id, store_id, total").eq("hub_order_id", hubOrderId);
  const hubOwnStoreOrders = hubOrders?.filter((o) => o.store_id === hubStoreId) ?? [];
  const affStoreOrders = hubOrders?.filter((o) => o.store_id === affStoreId) ?? [];
  if (hubOwnStoreOrders.length === 1 && affStoreOrders.length === 1) {
    ok("cada loja envolvida vê exatamente 1 pedido próprio (visão separada por painel)");
  } else fail("deveria ter 1 pedido por loja", JSON.stringify({ hubOwnStoreOrders, affStoreOrders }));

  // 4) saldo do afiliado foi creditado com 80% da venda dele (comissão 20% fica com o hub)
  const { data: partnershipAfter } = await admin.from("affiliate_partnerships").select("balance").eq("id", partnershipId).single();
  const expectedAffiliateShare = 30 * 0.8; // total do afiliado * (100-20)/100
  if (Math.abs(partnershipAfter.balance - expectedAffiliateShare) < 0.01) {
    ok(`saldo do afiliado creditado corretamente: R$${partnershipAfter.balance} (esperado R$${expectedAffiliateShare})`);
  } else fail("saldo do afiliado incorreto", `got=${partnershipAfter.balance} expected=${expectedAffiliateShare}`);

  // 5) settlement transaction registrada com order_id certo
  const { data: settlement } = await admin.from("affiliate_settlement_transactions")
    .select("type, amount, order_id").eq("partnership_id", partnershipId).eq("type", "venda").maybeSingle();
  if (settlement && settlement.order_id === affLine.order_id && Math.abs(settlement.amount - expectedAffiliateShare) < 0.01) {
    ok("lançamento 'venda' criado com order_id e valor corretos");
  } else fail("lançamento 'venda' incorreto", JSON.stringify(settlement));

  // 6) nenhum settlement criado pro hub (venda própria não gera repasse pra si mesmo)
  const { data: hubSettlement } = await admin.from("affiliate_settlement_transactions").select("id").eq("order_id", hubLine.order_id).maybeSingle();
  if (!hubSettlement) ok("venda do hub pra si mesmo não gera lançamento de repasse (correto)");
  else fail("não deveria gerar lançamento pra venda própria do hub", hubSettlement);

  // 7) estoque foi descontado nas DUAS lojas
  const { data: hubProdAfter } = await admin.from("products").select("stock").eq("id", hubProductId).single();
  const { data: affProdAfter } = await admin.from("products").select("stock").eq("id", affProductId).single();
  if (hubProdAfter.stock === 9 && affProdAfter.stock === 8) ok("estoque descontado corretamente nas duas lojas (1 e 2 unidades)");
  else fail("estoque deveria ter descontado nas duas lojas", JSON.stringify({ hub: hubProdAfter.stock, aff: affProdAfter.stock }));

  // 8) get_hub_order_receipt devolve as 2 linhas discriminadas
  const { data: receipt, error: receiptErr } = await anon.rpc("get_hub_order_receipt", { p_hub_order_id: hubOrderId });
  if (receiptErr || !receipt || receipt.length !== 2) fail("get_hub_order_receipt devolve 2 linhas", receiptErr?.message ?? JSON.stringify(receipt));
  else ok("get_hub_order_receipt devolve 1 linha por loja, discriminado");

  // 9) validação: loja fora do hub deve ser rejeitada
  const { data: outsider } = await admin.auth.admin.createUser({
    email: `${MARK}-fora-${Date.now()}@example.com`, password: "Teste123!" + Math.random(), email_confirm: true,
  });
  const { data: outsiderStores } = await admin.from("stores").select("id").eq("owner_id", outsider.user.id);
  const outsiderStoreId = outsiderStores[0].id;
  await admin.from("products").insert({ store_id: outsiderStoreId, name: "Produto Fora", price: 5, stock: 5, stock_alert_threshold: 5, on_offer: false, offer_price: null });
  const { data: outsiderProduct } = await admin.from("products").select("id").eq("store_id", outsiderStoreId).single();

  const { error: rejectErr } = await anon.rpc("checkout_hub", {
    p_hub_store_id: hubStoreId, p_customer_name: "Teste Malicioso", p_customer_phone: "11900000098",
    p_carts: [{ store_id: outsiderStoreId, items: [{ product_id: outsiderProduct.id, quantity: 1 }] }],
  });
  if (rejectErr) ok("checkout_hub rejeita loja que não é o hub nem afiliado ativo dele");
  else fail("checkout_hub deveria rejeitar loja fora do hub", "não rejeitou");

  await admin.from("stores").delete().eq("id", outsiderStoreId);

  console.log("\nResumo:", results.filter((r) => r[1]).length, "de", results.length, "passaram.");
}

async function cleanup() {
  if (hubStoreId) await admin.from("stores").delete().eq("id", hubStoreId);
  if (affStoreId) await admin.from("stores").delete().eq("id", affStoreId);
  const { data: list } = await admin.auth.admin.listUsers();
  for (const u of list.users.filter((x) => x.email?.startsWith(MARK))) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  console.log("Limpo.");
}

main().catch((e) => console.error("Erro inesperado:", e)).finally(cleanup);
