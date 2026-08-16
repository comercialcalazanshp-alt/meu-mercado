// Semeia uma loja de teste com 3 condições que deveriam disparar alerta:
// produto com estoque baixo, pedido parado há mais de 20min, entrega a
// caminho há mais de 45min. Roda: node --env-file=.env.local test-alerts-data.mjs
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const donoEmail = "teste.alertas.dono@meumercado.local";
const password = "TesteAlertas123!";

async function upsertUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return data.user.id;
  const { data: list } = await admin.auth.admin.listUsers();
  return list.users.find((u) => u.email === email).id;
}

const donoId = await upsertUser(donoEmail);
await admin.from("stores").delete().eq("owner_id", donoId).neq("slug", "loja-teste-alertas");

let { data: store } = await admin.from("stores").select("id").eq("slug", "loja-teste-alertas").maybeSingle();
if (!store) {
  const { data: newStore, error } = await admin.from("stores")
    .insert({ owner_id: donoId, slug: "loja-teste-alertas", name: "Loja Teste Alertas" })
    .select("id").single();
  if (error) throw error;
  store = newStore;
}
const storeId = store.id;

const { data: product, error: prodErr } = await admin.from("products").insert({
  store_id: storeId, name: "Produto Estoque Baixo", price: 10, stock: 2, stock_alert_threshold: 5, active: true,
}).select("id").single();
if (prodErr) throw prodErr;

const { data: stalledOrder, error: stalledErr } = await admin.from("orders").insert({
  store_id: storeId, customer_name: "Cliente Parado", customer_phone: "11900000001",
  items: [], total: 20, status: "pendente",
  created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
}).select("id").single();
if (stalledErr) throw stalledErr;

const { data: delayedOrder, error: delayedErr } = await admin.from("orders").insert({
  store_id: storeId, customer_name: "Cliente Atrasado", customer_phone: "11900000002",
  items: [], total: 30, status: "entregando", delivery_address: "Rua X, 1",
  created_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  out_for_delivery_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
}).select("id").single();
if (delayedErr) throw delayedErr;

console.log(JSON.stringify({ storeId, productId: product.id, stalledOrderId: stalledOrder.id, delayedOrderId: delayedOrder.id }, null, 2));
