import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente com acesso total ao banco (ignora as regras de segurança) — só pode
// ser importado de código que roda no servidor (a linha "server-only" acima
// quebra o build se algum componente de navegador tentar importar esse
// arquivo). Usado exclusivamente pelo painel /admin (dono da plataforma).
let client: SupabaseClient | undefined;

export function getSupabaseAdmin() {
  if (!client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}
