import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Só criado quando alguém chama getSupabase() de dentro de uma função — nunca
// no momento em que esse arquivo é importado. Isso evita erro durante etapas
// do build (ex: leitura de configuração da página) que carregam o módulo
// antes das variáveis de ambiente estarem disponíveis.
//
// Reaproveita a mesma instância depois de criada: cada instância nova do
// GoTrueClient escuta o storage de sessão, então criar uma por chamada geraria
// vários "ouvintes" de sessão concorrendo entre si (login/logout ficariam
// inconsistentes entre páginas).
let client: SupabaseClient | undefined;

export function getSupabase() {
  if (!client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    client = createClient(supabaseUrl, supabaseAnonKey);
  }
  return client;
}
