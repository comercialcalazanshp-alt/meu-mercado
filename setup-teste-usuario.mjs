// Cria uma loja de teste com dono + entregador + 1 afiliado + 1 pedido
// pra entregar, pra o usuário mexer no painel de verdade antes de decidir
// publicar. NÃO limpa sozinho — fica no banco até avisar pra apagar.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const password = "Teste123!";
const donoEmail = "teste.dono@meumercado.local";
const entregadorEmail = "teste.entregador@meumercado.local";

async function upsertUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return data.user.id;
  // já existe de uma rodada anterior — busca o id
  const { data: list } = await admin.auth.admin.listUsers();
  const found = list.users.find((u) => u.email === email);
  if (found) return found.id;
  throw new Error(error.message);
}

const donoId = await upsertUser(donoEmail);
const entregadorId = await upsertUser(entregadorEmail);

let { data: store } = await admin.from("stores").select("id").eq("slug", "loja-teste-hub").maybeSingle();
if (!store) {
  const { data: newStore, error } = await admin.from("stores")
    .insert({ owner_id: donoId, slug: "loja-teste-hub", name: "Loja Teste (Hub)" })
    .select("id").single();
  if (error) throw error;
  store = newStore;
}
const storeId = store.id;

await admin.from("store_members").upsert(
  { store_id: storeId, email: entregadorEmail, role: "entregador" },
  { onConflict: "store_id,email" },
);

await admin.from("affiliate_settings").upsert({ hub_store_id: storeId }, { onConflict: "hub_store_id" });

const { data: extraStoreExisting } = await admin.from("stores").select("id").eq("slug", "loja-teste-afiliado").maybeSingle();
let afiliadoStoreId = extraStoreExisting?.id;
if (!afiliadoStoreId) {
  const { data: afiliadoOwner } = await admin.auth.admin.createUser({
    email: "teste.afiliado.dono@meumercado.local", password, email_confirm: true,
  }).catch(() => ({ data: null }));
  const ownerIdForAfiliado = afiliadoOwner?.user?.id ?? donoId;
  const { data: afiliadoStore, error } = await admin.from("stores")
    .insert({ owner_id: ownerIdForAfiliado, slug: "loja-teste-afiliado", name: "Padaria Teste" })
    .select("id").single();
  if (error) throw error;
  afiliadoStoreId = afiliadoStore.id;
}

const { data: existingPartnership } = await admin.from("affiliate_partnerships")
  .select("id").eq("hub_store_id", storeId).eq("module_store_id", afiliadoStoreId).maybeSingle();
if (!existingPartnership) {
  await admin.from("affiliate_partnerships").insert({
    hub_store_id: storeId, module_store_id: afiliadoStoreId,
    category: "padaria", owner_name: "Dono da Padaria Teste", tax_id: "00000000000",
    address: "Rua de Teste, 123", commission_percent: 12,
  });
}

await admin.from("orders").insert({
  store_id: storeId, customer_name: "Cliente Exemplo", customer_phone: "11988887777",
  items: [{ name: "Produto Teste", price: 15, quantity: 1, line_total: 15 }], total: 15,
  status: "confirmado", delivery_address: "Av. Teste, 999", payment_method: "combinar",
});

console.log(JSON.stringify({
  loja: "http://localhost:3000/painel (depois de logar)",
  login: "http://localhost:3000/entrar",
  dono: { email: donoEmail, senha: password },
  entregador: { email: entregadorEmail, senha: password },
  storeId, afiliadoStoreId,
}, null, 2));
