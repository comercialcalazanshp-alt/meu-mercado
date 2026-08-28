// Cria uma loja + conta de dono de TESTE, só pra revisão visual — não é
// uma loja real, não recebe pedido de verdade, pode ser apagada depois.
// Rodar: node --env-file=.env.local create-test-owner.mjs

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltou variável de ambiente no .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = `teste-visual-${Date.now()}@meumercado.app`;
const password = crypto.randomBytes(9).toString("base64").replace(/[/+=]/g, "x") + "!1";

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: {
    store_name: "Loja Teste Visual",
    store_slug: `teste-visual-${Date.now()}`,
    whatsapp: "11999999999",
  },
});

if (error) {
  console.error("Falhou:", error.message);
  process.exit(1);
}

console.log("Conta de teste criada.");
console.log("E-mail:", email);
console.log("Senha:", password);
console.log("User id:", data.user.id);
