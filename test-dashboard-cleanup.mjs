import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

for (const slug of ["loja-teste-dash", "loja-teste-dash-afiliado"]) {
  const { data: store } = await admin.from("stores").select("id").eq("slug", slug).maybeSingle();
  if (store) {
    await admin.from("stores").delete().eq("id", store.id);
    console.log("loja removida:", slug);
  }
}

for (const email of ["teste.dash.dono@meumercado.local", "teste.dash.afiliado@meumercado.local"]) {
  const { data: list } = await admin.auth.admin.listUsers();
  const user = list.users.find((u) => u.email === email);
  if (user) {
    await admin.auth.admin.deleteUser(user.id);
    console.log("usuario removido:", email);
  }
}
console.log("Limpo.");
