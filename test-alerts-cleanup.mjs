import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: store } = await admin.from("stores").select("id").eq("slug", "loja-teste-alertas").maybeSingle();
if (store) await admin.from("stores").delete().eq("id", store.id);
const { data: list } = await admin.auth.admin.listUsers();
const user = list.users.find((u) => u.email === "teste.alertas.dono@meumercado.local");
if (user) await admin.auth.admin.deleteUser(user.id);
console.log("limpo");
