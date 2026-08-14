import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente separado do getSupabase() normal, com um storageKey diferente.
// Necessário porque a mesma pessoa pode estar logada como dono de loja
// (/painel) e como cliente comprador (/loja/[slug]) no mesmo navegador — sem
// isso as duas sessões do Supabase Auth colidiriam no mesmo espaço do
// localStorage e uma derrubaria a outra.
let client: SupabaseClient | undefined;

export function getCustomerSupabase() {
  if (!client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { storageKey: "meu-mercado-cliente-auth" },
    });
  }
  return client;
}
