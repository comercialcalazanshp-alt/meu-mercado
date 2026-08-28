// Popula a Loja Teste Visual com produtos/categorias fake pra dar pra ver
// as telas com conteúdo de verdade (espaçamento de lista/grid etc.)
// Rodar: node --env-file=.env.local seed-test-data.mjs <store_id>

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const storeId = process.argv[2];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltou variável de ambiente no .env.local");
  process.exit(1);
}
if (!storeId) {
  console.error("Uso: node seed-test-data.mjs <store_id>");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const products = [
  { name: "Arroz Branco Tipo 1 5kg", category: "Mercearia", price: 24.9, stock: 40 },
  { name: "Feijão Carioca 1kg", category: "Mercearia", price: 8.5, stock: 60 },
  { name: "Refrigerante Cola 2L", category: "Bebidas", price: 9.99, stock: 25 },
  { name: "Leite Integral 1L", category: "Laticínios", price: 5.49, stock: 3 },
  { name: "Sabão em Pó 1kg", category: "Limpeza", price: 14.9, stock: 18 },
  { name: "Detergente Neutro", category: "Limpeza", price: 2.49, stock: 0 },
  { name: "Café Torrado 500g", category: "Mercearia", price: 16.9, stock: 12 },
  { name: "Papel Higiênico 12 rolos", category: "Higiene", price: 22.5, stock: 30 },
];

const { data, error } = await admin
  .from("products")
  .insert(products.map((p) => ({ store_id: storeId, ...p, active: true })))
  .select("id");

if (error) {
  console.error("Falhou:", error.message);
  process.exit(1);
}
console.log(`${data.length} produtos criados.`);
