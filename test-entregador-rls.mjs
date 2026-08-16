// Testa a policy nova de RLS que dá acesso à tabela "orders" pro cargo
// "entregador" (e "caixa") via my_pdv_store_ids() — adicionada na v73.
// Roda: node --env-file=.env.local test-entregador-rls.mjs
// Cria loja + pedido + usuário de teste totalmente descartáveis, testa
// que o entregador VÊ e ATUALIZA o pedido, e que uma pessoa de fora não
// vê nada. Limpa tudo no final.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const MARK = "teste-entregador-rls";
const results = [];
function ok(l) { results.push([l, true]); console.log("✅", l); }
function fail(l, d) { results.push([l, false]); console.log("❌", l, "—", d); }

let storeId, orderId, ownerUserId, entregadorUserId, outsiderUserId;
const entregadorEmail = `teste-entregador-${Date.now()}@example.com`;
const outsiderEmail = `teste-outsider-${Date.now()}@example.com`;
const password = "TesteRLS!" + Math.random().toString(36).slice(2);

async function main() {
  const { data: ownerUser, error: ownerErr } = await admin.auth.admin.createUser({
    email: `teste-dono-${Date.now()}@example.com`, password, email_confirm: true,
  });
  if (ownerErr) return fail("criar usuário dono", ownerErr.message);
  ownerUserId = ownerUser.user.id;

  const { data: store, error: storeErr } = await admin.from("stores")
    .insert({ owner_id: ownerUser.user.id, slug: `${MARK}-${Date.now()}`, name: `${MARK} Loja` })
    .select("id").single();
  if (storeErr) return fail("criar loja de teste", storeErr.message);
  storeId = store.id;
  ok("criar loja de teste descartável");

  const { data: order, error: orderErr } = await admin.from("orders")
    .insert({ store_id: storeId, customer_name: "Cliente Teste", customer_phone: "11999999999", items: [], total: 10, status: "confirmado" })
    .select("id").single();
  if (orderErr) return fail("criar pedido de teste", orderErr.message);
  orderId = order.id;
  ok("criar pedido de teste (status confirmado)");

  const { data: entregadorUser, error: e1 } = await admin.auth.admin.createUser({ email: entregadorEmail, password, email_confirm: true });
  if (e1) return fail("criar usuário entregador", e1.message);
  entregadorUserId = entregadorUser.user.id;
  await admin.from("store_members").insert({ store_id: storeId, email: entregadorEmail, role: "entregador" });
  ok("criar membro da equipe com cargo entregador");

  const { data: outsiderUser, error: e2 } = await admin.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true });
  if (e2) return fail("criar usuário de fora", e2.message);
  outsiderUserId = outsiderUser.user.id;
  ok("criar usuário sem nenhuma relação com a loja (controle negativo)");

  const entregadorClient = createClient(SUPABASE_URL, ANON_KEY);
  await entregadorClient.auth.signInWithPassword({ email: entregadorEmail, password });
  const { data: seenByEntregador, error: selErr } = await entregadorClient.from("orders").select("id, status").eq("id", orderId);
  if (selErr) fail("entregador consegue SELECT no pedido", selErr.message);
  else if (seenByEntregador?.length === 1) ok("entregador consegue SELECT no pedido (RLS liberou)");
  else fail("entregador consegue SELECT no pedido", "veio 0 linhas — RLS bloqueou");

  const { error: updErr } = await entregadorClient.from("orders").update({ status: "entregando" }).eq("id", orderId);
  if (updErr) fail("entregador consegue UPDATE do status", updErr.message);
  else {
    const { data: afterUpd } = await admin.from("orders").select("status").eq("id", orderId).single();
    if (afterUpd?.status === "entregando") ok("entregador consegue UPDATE do status (confirmado -> entregando)");
    else fail("entregador consegue UPDATE do status", `status ficou "${afterUpd?.status}", esperava "entregando"`);
  }

  const outsiderClient = createClient(SUPABASE_URL, ANON_KEY);
  await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password });
  const { data: seenByOutsider } = await outsiderClient.from("orders").select("id").eq("id", orderId);
  if (!seenByOutsider || seenByOutsider.length === 0) ok("usuário de fora NÃO vê o pedido (RLS bloqueou corretamente)");
  else fail("usuário de fora NÃO vê o pedido", "RLS vazou — pessoa de fora conseguiu ver");

  console.log("\nResumo:", results.filter((r) => r[1]).length, "de", results.length, "passaram.");
}

async function cleanup() {
  console.log("\nLimpando dados de teste...");
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  for (const id of [ownerUserId, entregadorUserId, outsiderUserId]) {
    if (id) await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  console.log("Limpo.");
}

main().catch((e) => console.error("Erro inesperado:", e)).finally(cleanup);
