// Acha, no cadastro de produtos, os candidatos mais parecidos com o nome que
// veio escrito na nota fiscal. Nota usa abreviação ("SAB LIQ", "SH", "CR DENT")
// e o cadastro usa outra — por isso o casamento é por pedaços de palavra
// (prefixo), não por nome inteiro igual, e palavra rara pesa mais que palavra
// comum (um "TUBAINA" genérico no cadastro tem que aparecer pra "Tubaína
// Guaraná Meu Nei 2L", mesmo sem nenhuma outra palavra em comum).
// Quem decide o produto certo entre os candidatos é a IA + o dono na tela de
// conferência; aqui só se afunila.

export type CatalogProduct = {
  id: string;
  name: string;
  barcode: string | null;
  price: number;
  cost_price: number | null;
  stock: number;
  sold_by_weight: boolean;
};

export function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// "325ML" vira "325" + "ML"; "LV12PG10" vira "LV" "12" "PG" "10" — a nota e o
// cadastro escrevem medida e quantidade grudadas ou separadas de jeitos diferentes.
export function tokensOf(text: string): string[] {
  const normalized = normalizeName(text).replace(/([A-Z])(\d)/g, "$1 $2").replace(/(\d)([A-Z])/g, "$1 $2");
  return normalized.split(" ").filter((t) => t.length >= 2 || /^\d$/.test(t));
}

function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 3 && longer.startsWith(shorter);
}

export type CatalogIndex = {
  products: CatalogProduct[];
  tokens: string[][];
  idf: Map<string, number>;
  total: number;
};

export function buildIndex(products: CatalogProduct[]): CatalogIndex {
  const tokens = products.map((p) => tokensOf(p.name));
  const df = new Map<string, number>();
  for (const list of tokens) for (const t of new Set(list)) df.set(t, (df.get(t) ?? 0) + 1);
  const total = products.length;
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log((total + 1) / (n + 0.5)));
  return { products, tokens, idf, total };
}

function weight(index: CatalogIndex, token: string): number {
  // palavra que não existe em nenhum produto (ex: "NEI") não ajuda nem atrapalha muito
  return index.idf.get(token) ?? Math.log(index.total + 1) * 0.5;
}

export function topCandidates(queryText: string, index: CatalogIndex, limit = 8): CatalogProduct[] {
  const query = tokensOf(queryText);
  if (query.length === 0) return [];
  const queryWeight = query.reduce((s, t) => s + weight(index, t), 0) || 1;

  const scored: { product: CatalogProduct; score: number }[] = [];
  index.products.forEach((product, i) => {
    const ptokens = index.tokens[i];
    if (ptokens.length === 0) return;
    let hitWeight = 0;
    for (const q of query) if (ptokens.some((p) => tokenMatches(q, p))) hitWeight += weight(index, q);
    if (hitWeight === 0) return;
    let pHit = 0;
    let pTotal = 0;
    for (const p of ptokens) {
      const w = weight(index, p);
      pTotal += w;
      if (query.some((q) => tokenMatches(q, p))) pHit += w;
    }
    // 70%: quanto da nota foi encontrado; 30%: quanto do nome cadastrado foi coberto
    scored.push({ product, score: 0.7 * (hitWeight / queryWeight) + 0.3 * (pHit / (pTotal || 1)) });
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.product);
}

// Similaridade simples entre duas descrições (usada pra casar a mesma linha
// entre duas leituras da mesma nota).
export function descriptionSimilarity(a: string, b: string): number {
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const hits = ta.filter((x) => tb.some((y) => tokenMatches(x, y))).length;
  return (2 * hits) / (ta.length + tb.length);
}
