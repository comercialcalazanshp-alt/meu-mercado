// Testa o fluxo completo novo do cargo entregador (schema-v74):
// cadastro -> aceite do termo (API) -> gerar login (API) -> login de
// verdade -> entrega marcada -> delivered_by preenchido sozinho -> "a
// receber" bate -> entregador NÃO consegue se auto-declarar pago -> dono
// consegue marcar como pago.
// Roda: node --env-file=.env.local test-entregador-cadastro.mjs
// Precisa do servidor local rodando em http://localhost:3000.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = "http://localhost:3000";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const MARK = "teste-entregador-cadastro";
const results = [];
function ok(l) { results.push([l, true]); console.log("✅", l); }
function fail(l, d) { results.push([l, false]); console.log("❌", l, "—", d); }

let ownerId, storeId, memberId, orderId, entregadorPseudoEmail;
const ownerEmail = `${MARK}-dono-${Date.now()}@example.com`;
const ownerPassword = "TesteDono!" + Math.random().toString(36).slice(2);

async function main() {
  const { data: owner, error: ownerErr } = await admin.auth.admin.createUser({
    email: ownerEmail, password: ownerPassword, email_confirm: true,
  });
  if (ownerErr) return fail("criar dono de teste", ownerErr.message);
  ownerId = owner.user.id;

  const { data: store, error: storeErr } = await admin.from("stores")
    .insert({ owner_id: ownerId, slug: `${MARK}-${Date.now()}`, name: `${MARK} Loja` })
    .select("id").single();
  if (storeErr) return fail("criar loja de teste", storeErr.message);
  storeId = store.id;
  ok("criar dono + loja de teste");

  const phone = "11" + Math.floor(900000000 + Math.random() * 99999999);
  entregadorPseudoEmail = `${phone}@entregador.meumercado.app`;
  const { data: member, error: memberErr } = await admin.from("store_members").insert({
    store_id: storeId, email: entregadorPseudoEmail, role: "entregador",
    full_name: "Entregador de Teste", phone, birth_date: "2000-01-01", value_per_delivery: 1,
  }).select("id").single();
  if (memberErr) return fail("cadastrar entregador (dono)", memberErr.message);
  memberId = member.id;
  ok("cadastrar entregador com nome/telefone/nascimento/valor por entrega");

  // Aceite com texto errado -> deve recusar
  const rejRes = await fetch(`${APP_URL}/api/equipe/aceitar-entregador`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: memberId, confirmacao: "talvez" }),
  });
  if (rejRes.status === 400) ok("recusa aceite com texto que não é SIM");
  else fail("recusa aceite com texto que não é SIM", `status ${rejRes.status}`);

  // Aceite certo (minúsculo, pra testar case-insensitive)
  const accRes = await fetch(`${APP_URL}/api/equipe/aceitar-entregador`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: memberId, confirmacao: "sim" }),
  });
  const accData = await accRes.json();
  if (accRes.ok && accData.ok) ok("aceita o termo digitando sim (minúsculo)");
  else fail("aceita o termo", JSON.stringify(accData));

  // Login do dono, pra chamar a rota autenticada de gerar login
  const ownerClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: signIn, error: signInErr } = await ownerClient.auth.signInWithPassword({
    email: ownerEmail, password: ownerPassword,
  });
  if (signInErr) return fail("logar como dono", signInErr.message);
  ok("logar como dono");

  const genRes = await fetch(`${APP_URL}/api/equipe/gerar-login-entregador`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${signIn.session.access_token}` },
    body: JSON.stringify({ storeMemberId: memberId }),
  });
  const genData = await genRes.json();
  if (genRes.ok && genData.email && genData.senha) ok("dono gera login e senha do entregador");
  else { fail("dono gera login e senha", JSON.stringify(genData)); return; }

  // Login de verdade como o entregador, com o que a rota gerou
  const entregadorClient = createClient(SUPABASE_URL, ANON_KEY);
  const { error: entLoginErr } = await entregadorClient.auth.signInWithPassword({
    email: genData.email, password: genData.senha,
  });
  if (entLoginErr) return fail("logar como entregador com login gerado", entLoginErr.message);
  ok("logar como entregador com o login/senha gerados");

  // Cria um pedido (via admin, simula um pedido real já existente) e o
  // entregador marca como entregue — delivered_by tem que se preencher
  // sozinho.
  const { data: order, error: orderErr } = await admin.from("orders").insert({
    store_id: storeId, customer_name: "Cliente Teste", customer_phone: "11999999999",
    items: [], total: 10, status: "confirmado", delivery_address: "Rua Teste, 1",
  }).select("id").single();
  if (orderErr) return fail("criar pedido de teste", orderErr.message);
  orderId = order.id;

  const { error: updErr } = await entregadorClient.from("orders")
    .update({ status: "entregue", delivered_at: new Date().toISOString() })
    .eq("id", orderId);
  if (updErr) return fail("entregador marca pedido como entregue", updErr.message);

  const { data: afterDeliver } = await admin.from("orders").select("delivered_by, delivery_payout_settled").eq("id", orderId).single();
  if (afterDeliver?.delivered_by === memberId) ok("delivered_by preenchido sozinho com o id certo do entregador");
  else fail("delivered_by preenchido sozinho", `veio ${afterDeliver?.delivered_by}, esperava ${memberId}`);

  // Entregador tenta se auto-declarar pago — tem que ser barrado
  await entregadorClient.from("orders").update({ delivery_payout_settled: true }).eq("id", orderId);
  const { data: afterSelfPay } = await admin.from("orders").select("delivery_payout_settled").eq("id", orderId).single();
  if (afterSelfPay?.delivery_payout_settled === false) ok("entregador NÃO consegue se auto-declarar pago (travado)");
  else fail("entregador NÃO consegue se auto-declarar pago", "conseguiu marcar como pago sozinho — falha de segurança");

  // Entregador consegue ler a própria linha (nome/valor por entrega)
  const { data: ownRow, error: ownRowErr } = await entregadorClient
    .from("store_members").select("id, full_name, value_per_delivery").eq("store_id", storeId).eq("role", "entregador").maybeSingle();
  if (!ownRowErr && ownRow?.value_per_delivery === 1) ok("entregador consegue ler a própria linha (valor por entrega)");
  else fail("entregador consegue ler a própria linha", ownRowErr?.message ?? "veio vazio");

  // Dono marca como pago
  const { error: payErr } = await ownerClient.from("orders")
    .update({ delivery_payout_settled: true })
    .eq("store_id", storeId).eq("delivered_by", memberId).eq("delivery_payout_settled", false);
  if (payErr) return fail("dono marca entrega como paga", payErr.message);
  const { data: afterOwnerPay } = await admin.from("orders").select("delivery_payout_settled").eq("id", orderId).single();
  if (afterOwnerPay?.delivery_payout_settled === true) ok("dono consegue marcar a entrega como paga");
  else fail("dono consegue marcar a entrega como paga", "não atualizou");

  console.log("\nResumo:", results.filter((r) => r[1]).length, "de", results.length, "passaram.");
}

async function cleanup() {
  console.log("\nLimpando dados de teste...");
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  if (entregadorPseudoEmail) {
    const { data: usersPage } = await admin.auth.admin.listUsers();
    const entregadorUser = usersPage?.users.find((u) => u.email === entregadorPseudoEmail);
    if (entregadorUser) await admin.auth.admin.deleteUser(entregadorUser.id).catch(() => {});
  }
  if (ownerId) await admin.auth.admin.deleteUser(ownerId).catch(() => {});
  console.log("Limpo.");
}

main().catch((e) => console.error("Erro inesperado:", e)).finally(cleanup);
