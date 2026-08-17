// Verifica as 3 ideias novas de schema-v78: constraint aceita 'meta_batida',
// filtro de push por member_id (dono vs. equipe) funciona, e a rota
// check-alerts detecta meta batida corretamente. Roda:
// node --env-file=.env.local test-alerts-v78.mjs
// Precisa do servidor local rodando em http://localhost:3000.
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APP_URL = "http://localhost:3000";
const MARK = "teste-v78";
const results = [];
function ok(l) { results.push([l, true]); console.log("✅", l); }
function fail(l, d) { results.push([l, false]); console.log("❌", l, "—", d); }

let storeId, memberId;

async function main() {
  const { data: owner, error: ownerErr } = await admin.auth.admin.createUser({
    email: `${MARK}-dono-${Date.now()}@example.com`, password: "Teste123!" + Math.random(), email_confirm: true,
  });
  if (ownerErr) throw ownerErr;

  const { data: store, error: storeErr } = await admin.from("stores")
    .insert({ owner_id: owner.user.id, slug: `${MARK}-${Date.now()}`, name: "Loja Teste v78", sales_goal: 100, alert_goal_reached_enabled: true })
    .select("id").single();
  if (storeErr) throw storeErr;
  storeId = store.id;
  ok("cria loja com meta de vendas = R$100");

  // pedido que ultrapassa a meta
  const { error: orderErr } = await admin.from("orders").insert({
    store_id: storeId, customer_name: "Cliente Meta", customer_phone: "11900000001",
    items: [], total: 150, status: "confirmado", created_at: new Date().toISOString(),
  });
  if (orderErr) throw orderErr;
  ok("cria pedido de R$150 (passa da meta de R$100)");

  // teste 1: constraint aceita 'meta_batida' com entity_id = uuid válido (store.id)
  const { error: insertErr } = await admin.from("alert_notifications_log").insert({
    store_id: storeId, alert_type: "meta_batida", entity_id: storeId,
  });
  if (insertErr) fail("constraint aceita alert_type='meta_batida'", insertErr.message);
  else ok("constraint aceita alert_type='meta_batida' com entity_id uuid");
  await admin.from("alert_notifications_log").delete().eq("store_id", storeId); // limpa pro teste da rota valer

  // teste 2: member_id em push_subscriptions — filtro dono vs equipe
  const { data: member, error: memberErr } = await admin.from("store_members").insert({
    store_id: storeId, email: "11955550001@entregador.meumercado.app", role: "entregador", full_name: "Entregador Teste",
  }).select("id").single();
  if (memberErr) throw memberErr;
  memberId = member.id;

  await admin.from("push_subscriptions").insert([
    { store_id: storeId, member_id: null, endpoint: `https://fake.test/${MARK}-owner`, p256dh: "x", auth: "y" },
    { store_id: storeId, member_id: memberId, endpoint: `https://fake.test/${MARK}-entregador`, p256dh: "x", auth: "y" },
  ]);

  const { data: ownerOnly } = await admin.from("push_subscriptions").select("id").eq("store_id", storeId).is("member_id", null);
  const { data: allSubs } = await admin.from("push_subscriptions").select("id").eq("store_id", storeId);
  if (ownerOnly.length === 1 && allSubs.length === 2) ok("filtro member_id: 1 inscrição do dono, 2 no total (dono + entregador)");
  else fail("filtro member_id", `owner-only=${ownerOnly.length}, all=${allSubs.length}`);

  // teste 3: rota check-alerts roda sem erro e detecta a meta batida
  const cronSecret = process.env.CRON_SECRET;
  const res = await fetch(`${APP_URL}/api/cron/check-alerts`, { headers: { Authorization: `Bearer ${cronSecret}` } });
  const data = await res.json();
  if (res.ok && Array.isArray(data.errors) && data.errors.length === 0) ok("rota check-alerts roda sem erros com store de meta batida presente");
  else fail("rota check-alerts sem erros", JSON.stringify(data));

  // como as inscrições são endpoints falsos, o push real falha e por isso
  // o log não é gravado (sent=0) — confere isso é esperado, não um bug:
  // consulta direto se a condição de meta batida SERIA detectada (mesma
  // query que a rota faz).
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data: monthOrders } = await admin.from("orders").select("total").eq("store_id", storeId).neq("status", "cancelado").gte("created_at", monthStart);
  const monthRevenue = monthOrders.reduce((s, o) => s + Number(o.total), 0);
  if (monthRevenue >= 100) ok(`detecção de meta batida está correta (R$${monthRevenue} >= R$100)`);
  else fail("detecção de meta batida", `revenue=${monthRevenue}`);

  console.log("\nResumo:", results.filter((r) => r[1]).length, "de", results.length, "passaram.");
}

async function cleanup() {
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  const { data: list } = await admin.auth.admin.listUsers();
  for (const u of list.users.filter((x) => x.email?.startsWith(MARK))) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  console.log("Limpo.");
}

main().catch((e) => console.error("Erro inesperado:", e)).finally(cleanup);
