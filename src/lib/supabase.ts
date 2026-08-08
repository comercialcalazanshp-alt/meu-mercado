import { createClient } from "@supabase/supabase-js";

// Criada só quando alguém chama getSupabase() de dentro de uma função — nunca
// no momento em que esse arquivo é importado. Isso evita erro durante etapas
// do build (ex: leitura de configuração da página) que carregam o módulo
// antes das variáveis de ambiente estarem disponíveis.
export function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createClient(supabaseUrl, supabaseAnonKey);
}
