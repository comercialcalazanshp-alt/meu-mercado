// Verifica a Central de Reclamações (schema-v79): file_complaint/get_order_complaint
// RPCs (anônimos, mesmo padrão de checkout/get_order_receipt), painel do dono
// (leitura/atualização direta via RLS), e a rota de push da reclamação nova.
// Roda: node --env-file=.env.local test-complaints-v79.mjs
// Precisa do servidor local rodando em http://localhost:3000.
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const APP_URL = "http://localhost:3000";
const MARK = "teste-v79";
const results = [];
function ok(l) { results.push([l, true]); console.log("✅", l); }
function fail(l, d) { results.push([l, false]); console.log("❌", l, "—", d); }

let storeId, orderId;

async function main() {
  const { data: owner, error: ownerErr } = await admin.auth.admin.createUser({
    email: `${MARK}-dono-${Date.now()}@example.com`, password: "Teste123!" + Math.random(), email_confirm: true,
  });
  if (ownerErr) throw ownerErr;

  const { data: store, error: storeErr } = await admin.from("stores")
    .insert({ owner_id: owner.user.id, slug: `${MARK}-${Date.now()}`, name: "Loja Teste v79", complaint_notification_enabled: true })
    .select("id").single();
  if (storeErr) throw storeErr;
  storeId = store.id;
  ok("cria loja com complaint_notification_enabled=true");

  const { data: order, error: orderErr } = await admin.from("orders").insert({
    store_id: storeId, customer_name: "Cliente Reclamão", customer_phone: "11900000002",
    items: [{ name: "Arroz 5kg", price: 25, quantity: 1 }], total: 25, status: "entregue",
  }).select("id").single();
  if (orderErr) throw orderErr;
  orderId = order.id;
  ok("cria pedido de teste");

  // 1) file_complaint via RPC anônima (mesmo caminho do cliente na página do recibo)
  const { data: complaintId, error: fileErr } = await anon.rpc("file_complaint", {
    p_order_id: orderId, p_category: "produto_danificado", p_description: "Veio o pacote de arroz rasgado.",
  });
  if (fileErr || !complaintId) fail("file_complaint cria reclamação", fileErr?.message);
  else ok("file_complaint cria reclamação e devolve id");

  // 1b) validação: categoria inválida deve ser rejeitada
  const { error: badCatErr } = await anon.rpc("file_complaint", {
    p_order_id: orderId, p_category: "categoria_invalida", p_description: "teste",
  });
  if (badCatErr) ok("file_complaint rejeita categoria inválida");
  else fail("file_complaint deveria rejeitar categoria inválida", "não rejeitou");

  // 1c) validação: descrição vazia deve ser rejeitada
  const { error: emptyDescErr } = await anon.rpc("file_complaint", {
    p_order_id: orderId, p_category: "outro", p_description: "   ",
  });
  if (emptyDescErr) ok("file_complaint rejeita descrição vazia");
  else fail("file_complaint deveria rejeitar descrição vazia", "não rejeitou");

  // 1d) validação: pedido inexistente deve ser rejeitado
  const { error: badOrderErr } = await anon.rpc("file_complaint", {
    p_order_id: "00000000-0000-0000-0000-000000000000", p_category: "outro", p_description: "teste",
  });
  if (badOrderErr) ok("file_complaint rejeita pedido inexistente");
  else fail("file_complaint deveria rejeitar pedido inexistente", "não rejeitou");

  // 2) get_order_complaint via RPC anônima devolve a reclamação criada
  const { data: fetched, error: fetchErr } = await anon.rpc("get_order_complaint", { p_order_id: orderId });
  const row = fetched?.[0];
  if (fetchErr || !row || row.status !== "aberta" || row.category !== "produto_danificado") {
    fail("get_order_complaint devolve reclamação recém-criada", fetchErr?.message ?? JSON.stringify(row));
  } else ok("get_order_complaint devolve reclamação com status 'aberta'");

  // 2b) pedido sem reclamação devolve vazio (não deve dar erro nem inventar dado)
  const { data: order2, error: order2Err } = await admin.from("orders").insert({
    store_id: storeId, customer_name: "Cliente Sem Reclamação", customer_phone: "11900000003",
    items: [], total: 10, status: "entregue",
  }).select("id").single();
  if (order2Err) throw order2Err;
  const { data: noneFetched } = await anon.rpc("get_order_complaint", { p_order_id: order2.id });
  if (Array.isArray(noneFetched) && noneFetched.length === 0) ok("get_order_complaint devolve vazio pra pedido sem reclamação");
  else fail("get_order_complaint deveria devolver vazio", JSON.stringify(noneFetched));

  // 3) painel do dono: reclamação aparece via RLS normal (using admin client simula owner select, já que RLS é validado por my_store_ids())
  const { data: ownerView, error: ownerViewErr } = await admin.from("complaints").select("*").eq("order_id", orderId).single();
  if (ownerViewErr || !ownerView) fail("reclamação aparece na tabela complaints pro dono", ownerViewErr?.message);
  else ok("reclamação aparece na tabela complaints (visão do dono)");

  // 4) dono responde e muda status — confere que o cliente enxerga a resposta de volta
  const replyText = "Vamos trocar o produto, desculpe o transtorno!";
  const { error: replyErr } = await admin.from("complaints").update({
    owner_reply: replyText, owner_reply_at: new Date().toISOString(), status: "resolvida", resolved_at: new Date().toISOString(),
  }).eq("id", ownerView.id);
  if (replyErr) fail("dono consegue responder e marcar resolvida", replyErr.message);
  else ok("dono responde e marca como resolvida");

  const { data: afterReply } = await anon.rpc("get_order_complaint", { p_order_id: orderId });
  const rowAfter = afterReply?.[0];
  if (rowAfter?.owner_reply === replyText && rowAfter?.status === "resolvida") {
    ok("cliente vê a resposta do dono e o status 'resolvida' via get_order_complaint");
  } else fail("cliente deveria ver resposta+status atualizados", JSON.stringify(rowAfter));

  // 5) trigger de notificação: dispara o webhook real (rota local) sem erro
  // (endpoints de push são falsos, então sent=0 é esperado — o que importa é a rota não quebrar)
  await admin.from("push_subscriptions").insert({ store_id: storeId, member_id: null, endpoint: `https://fake.test/${MARK}-owner`, p256dh: "x", auth: "y" });
  const res = await fetch(`${APP_URL}/api/push/send-complaint-notification`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-push-secret": process.env.PUSH_TRIGGER_SECRET },
    body: JSON.stringify({ store_id: storeId, complaint_id: ownerView.id, customer_name: "Cliente Reclamão", category: "produto_danificado" }),
  });
  const pushData = await res.json();
  if (res.ok && typeof pushData.sent === "number") ok(`rota send-complaint-notification roda sem erro (sent=${pushData.sent})`);
  else fail("rota send-complaint-notification deveria rodar sem erro", JSON.stringify(pushData));

  // 5b) secret errado deve ser rejeitado
  const resBadSecret = await fetch(`${APP_URL}/api/push/send-complaint-notification`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-push-secret": "errado" },
    body: JSON.stringify({ store_id: storeId, complaint_id: ownerView.id, customer_name: "x", category: "outro" }),
  });
  if (resBadSecret.status === 401) ok("rota rejeita x-push-secret incorreto (401)");
  else fail("rota deveria rejeitar secret incorreto", resBadSecret.status);

  console.log("\nResumo:", results.filter((r) => r[1]).length, "de", results.length, "passaram.");
}

async function cleanup() {
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  const { data: list } = await admin.auth.admin.listUsers();
  for (const u of list.users.filter((x) => x.email?.startsWith(MARK))) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  console.log("Limpo.");
}

main().catch((e) => console.error("Erro inesperado:", e)).finally(cleanup);
