// Cria uma loja de teste com dados espalhados nos últimos 14 dias (pedidos
// PDV/site, formas de pagamento variadas, entregas atribuídas a um
// entregador, uma assinatura de clube ativa e uma parceria de afiliado com
// mensalidade + 1 venda registrada) só pra validar visualmente o novo
// /painel/dashboard com números de verdade. Roda:
// node --env-file=.env.local test-dashboard-data.mjs
// NÃO limpa sozinho — rodar test-dashboard-cleanup.mjs depois de conferir.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const password = "TesteDash123!";
const donoEmail = "teste.dash.dono@meumercado.local";

async function upsertUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return data.user.id;
  const { data: list } = await admin.auth.admin.listUsers();
  const found = list.users.find((u) => u.email === email);
  if (found) return found.id;
  throw new Error(error.message);
}

const donoId = await upsertUser(donoEmail);

// createUser dispara o trigger handle_new_store_owner, que cria uma loja
// padrão vazia ("Minha loja") pro dono novo — sem remover ela, o dono fica
// com 2 lojas e o painel pode abrir a errada (vazia) em vez da de teste.
await admin.from("stores").delete().eq("owner_id", donoId).neq("slug", "loja-teste-dash");

let { data: store } = await admin.from("stores").select("id").eq("slug", "loja-teste-dash").maybeSingle();
if (!store) {
  const { data: newStore, error } = await admin.from("stores")
    .insert({ owner_id: donoId, slug: "loja-teste-dash", name: "Mercadinho Teste Dashboard" })
    .select("id").single();
  if (error) throw error;
  store = newStore;
}
const storeId = store.id;

const entregadorEmail = "11955550000@entregador.meumercado.app";
const { data: entregadorMember, error: entregadorErr } = await admin.from("store_members")
  .upsert(
    { store_id: storeId, email: entregadorEmail, role: "entregador", full_name: "Rafael Souza", phone: "11955550000", value_per_delivery: 1 },
    { onConflict: "store_id,email" },
  ).select("id").single();
if (entregadorErr) throw entregadorErr;

const PRODUCTS = [
  { name: "Arroz Tipo 1 5kg", price: 28.9 },
  { name: "Óleo de Soja 900ml", price: 8.5 },
  { name: "Refrigerante 2L", price: 9.9 },
  { name: "Feijão Carioca 1kg", price: 9.2 },
];
const PAY_METHODS = ["pix", "cartao", "dinheiro", "fiado"];

const orderIds = [];
for (let i = 0; i < 24; i++) {
  const daysAgo = Math.floor(Math.random() * 13);
  const createdAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000 - Math.random() * 20 * 3600 * 1000);
  const channel = Math.random() < 0.6 ? "pdv" : "site";
  const payment = PAY_METHODS[Math.floor(Math.random() * PAY_METHODS.length)];
  const item = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
  const qty = 1 + Math.floor(Math.random() * 3);
  const total = Math.round(item.price * qty * 100) / 100;
  const delivered = Math.random() < 0.5;
  const { data: order, error } = await admin.from("orders").insert({
    store_id: storeId, customer_name: "Cliente " + i, customer_phone: "1199888" + String(1000 + i),
    items: [{ name: item.name, price: item.price, quantity: qty }], total,
    status: delivered ? "entregue" : "confirmado", channel, payment_method: payment,
    created_at: createdAt.toISOString(),
    delivery_address: delivered ? "Rua Exemplo, " + i : null,
    delivered_at: delivered ? createdAt.toISOString() : null,
    delivered_by: delivered ? entregadorMember.id : null,
    delivery_payout_settled: delivered ? Math.random() < 0.6 : false,
  }).select("id").single();
  if (error) throw error;
  orderIds.push(order.id);
}

await admin.from("subscriptions").insert({
  store_id: storeId, customer_name: "Maria Fernandes", customer_phone: "11999990001",
  monthly_amount: 89.9, active: true, last_generated_at: new Date().toISOString(),
});
await admin.from("subscriptions").insert({
  store_id: storeId, customer_name: "João Pedro", customer_phone: "11999990002",
  monthly_amount: 59.9, active: true, last_generated_at: new Date().toISOString(),
});

const { data: afiliadoOwner } = await admin.auth.admin.createUser({
  email: "teste.dash.afiliado@meumercado.local", password, email_confirm: true,
}).catch(() => ({ data: null }));
let { data: afiliadoStore } = await admin.from("stores").select("id").eq("slug", "loja-teste-dash-afiliado").maybeSingle();
if (!afiliadoStore) {
  const { data: newAfiliadoStore, error } = await admin.from("stores")
    .insert({ owner_id: afiliadoOwner?.user?.id ?? donoId, slug: "loja-teste-dash-afiliado", name: "Padaria Teste Dashboard" })
    .select("id").single();
  if (error) throw error;
  afiliadoStore = newAfiliadoStore;
}

let { data: partnership } = await admin.from("affiliate_partnerships")
  .select("id").eq("hub_store_id", storeId).eq("module_store_id", afiliadoStore.id).maybeSingle();
if (!partnership) {
  const { data: newPartnership, error } = await admin.from("affiliate_partnerships").insert({
    hub_store_id: storeId, module_store_id: afiliadoStore.id,
    category: "padaria", owner_name: "Padaria do Zé", tax_id: "00000000000",
    address: "Rua de Teste, 123", commission_percent: 12,
    plan_type: "padrao", billing_cycle: "mensal", subscription_price: 79.9,
    subscription_due_at: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
  }).select("id").single();
  if (error) throw error;
  partnership = newPartnership;
}

await admin.from("affiliate_settlement_transactions").insert({
  partnership_id: partnership.id, type: "venda", amount: 42.5, order_id: orderIds[0],
});

await admin.from("expenses").insert([
  { store_id: storeId, description: "Aluguel", category: "aluguel", amount: 1200, expense_date: new Date().toISOString().slice(0, 10) },
  { store_id: storeId, description: "Conta de luz", category: "energia", amount: 180.5, expense_date: new Date().toISOString().slice(0, 10) },
]);

console.log(JSON.stringify({
  login: "http://localhost:3000/entrar",
  dashboard: "http://localhost:3000/painel/dashboard",
  dono: { email: donoEmail, senha: password },
  storeId,
}, null, 2));
