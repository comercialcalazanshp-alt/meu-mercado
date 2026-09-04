// Varre TODAS as telas do painel procurando por ".from(tabela).select(colunas)"
// e testa cada uma direto contra o banco real, pra achar qualquer outro caso
// do mesmo bug que quebrou Produtos (coluna que o código pede mas não
// existe de verdade na tabela). Não modifica nada — só SELECT.
//
// Rodar: node --env-file=.env.local test-schema-drift.mjs

import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

const files = walk("src/app/painel").concat(walk("src/app/api"));

// Pega .from("tabela") seguido (com espaço/quebra de linha no meio) de
// .select("colunas...") ou .select(`colunas...`) — ignora select("*") e
// selects com sub-relacionamentos entre parênteses (ex: kit_items(...)),
// que exigem lógica própria e não dá pra testar genericamente.
const pattern = /\.from\("([a-z_]+)"\)\s*\n?\s*\.select\(\s*[`"]([^`"]*)[`"]/g;

const pairs = new Map();
for (const file of files) {
  const content = readFileSync(file, "utf8");
  let m;
  while ((m = pattern.exec(content))) {
    const [, table, cols] = m;
    if (cols.includes("*") || cols.includes("(")) continue;
    const cleanCols = cols
      .split(",")
      .map((c) => c.trim().split(":")[0].trim())
      .filter(Boolean);
    if (cleanCols.length === 0) continue;
    const key = `${table}|${cleanCols.join(",")}`;
    if (!pairs.has(key)) pairs.set(key, { table, cols: cleanCols, file });
  }
}

console.log(`Testando ${pairs.size} combinações únicas de tabela+colunas achadas em ${files.length} arquivos...\n`);

let failures = 0;
for (const { table, cols, file } of pairs.values()) {
  const { error } = await admin.from(table).select(cols.join(",")).limit(1);
  if (error && (error.code === "42703" || error.code === "42P01")) {
    failures++;
    console.log(`FALHOU - ${table} (${file})`);
    console.log(`         colunas: ${cols.join(", ")}`);
    console.log(`         erro: ${error.message}\n`);
  }
}

console.log(failures === 0 ? "TUDO OK — nenhuma coluna/tabela faltando encontrada." : `\n${failures} problema(s) encontrado(s).`);
process.exit(failures === 0 ? 0 : 1);
