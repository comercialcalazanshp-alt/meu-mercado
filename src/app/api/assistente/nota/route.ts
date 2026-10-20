import "server-only";
import OpenAI from "openai";
import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { authorizeFullAccess } from "@/lib/assistente-auth";
import { buildIndex, descriptionSimilarity, topCandidates, type CatalogProduct } from "@/lib/nota-match";

// Ler foto + casar com o cadastro leva dezenas de segundos; sem isso a função
// seria cortada no limite padrão.
export const maxDuration = 120;

const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 3_500_000; // data URL em base64 (~2,6 MB de foto)
const PAGE_SIZE = 1000;

type NotaItem = {
  descricao: string;
  nome_provavel: string;
  unidade: string;
  quantidade_nota: number;
  valor_unitario: number;
  valor_total: number;
  unidades_por_embalagem: number;
  observacao: string;
};

type NotaExtraida = {
  fornecedor: string;
  numero_nota: string;
  total_nota: number | null;
  itens: NotaItem[];
};

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fornecedor", "numero_nota", "total_nota", "itens"],
  properties: {
    fornecedor: { type: "string" },
    numero_nota: { type: "string" },
    total_nota: { type: ["number", "null"] },
    itens: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "descricao",
          "nome_provavel",
          "unidade",
          "quantidade_nota",
          "valor_unitario",
          "valor_total",
          "unidades_por_embalagem",
          "observacao",
        ],
        properties: {
          descricao: { type: "string" },
          nome_provavel: { type: "string" },
          unidade: { type: "string" },
          quantidade_nota: { type: "number" },
          valor_unitario: { type: "number" },
          valor_total: { type: "number" },
          unidades_por_embalagem: { type: "number" },
          observacao: { type: "string" },
        },
      },
    },
  },
} as const;

const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["escolhas"],
  properties: {
    escolhas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["indice", "produto_id", "confianca"],
        properties: {
          indice: { type: "number" },
          produto_id: { type: ["string", "null"] },
          confianca: { type: "string", enum: ["alta", "media", "baixa"] },
        },
      },
    },
  },
} as const;

const EXTRACTION_PROMPT = `Você lê fotos de notas fiscais brasileiras (DANFE) de fornecedores de um mercadinho e devolve os produtos comprados, em JSON.

Regras:
- As fotos podem estar de lado, tortas ou um pouco borradas. Várias fotos são páginas da MESMA nota: junte tudo numa lista só, sem repetir item.
- Leia só a tabela "DADOS DO PRODUTO/SERVIÇOS". Ignore frete, impostos e totais como se fossem produto.
- "descricao": exatamente como está escrito na nota. "quantidade_nota", "valor_unitario" e "valor_total": exatamente os números da linha (quantidade e preço da linha, não do total da nota). Se um número estiver ilegível, use sua melhor leitura e explique em "observacao" — nunca invente e NUNCA ajuste um número para fechar a soma com o total da nota: leia cada linha como está escrita.
- "unidade": a sigla da nota (UN, KG, CX, FD, PCT...).
- "unidades_por_embalagem": quantas unidades que o mercado VENDE ao cliente vêm em cada unidade contada na nota. Se a linha já conta unidade de venda (UN solta, ou KG vendido avulso/em pacotes de 1 kg), use 1. Exemplos: fardo "2LX6" contado como 1 FD = 6 garrafas, então 6; "leve 12 pague 10" contado como 1 UN = 12 tubos, então 12; "(8UN)" no nome de absorvente é o conteúdo do pacote, então 1 se contado em pacotes. Em caso de dúvida use 1 e explique em "observacao".
- "nome_provavel": o nome que uma loja cadastraria, com as abreviações abertas e SEM quantidade de caixa/fardo (ex: "Sabonete Líquido Bozzano Antibac Fresh 240ml"). Mantenha marca, variação/fragrância e tamanho.
- "observacao": vazio quando está tudo certo; senão, em uma frase curta, o que ficou em dúvida.
- "fornecedor" e "numero_nota": do cabeçalho; "total_nota": valor total dos PRODUTOS da nota (ou null se não achar).`;

const MATCH_PROMPT = `Você casa itens de uma nota fiscal com produtos já cadastrados numa loja. Para cada item, escolha no máximo UM produto da lista de candidatos daquele item.
Regras:
- Só escolha se for com certeza o MESMO produto: mesma marca, mesmo tipo, mesmo tamanho/volume, mesma quantidade na embalagem (ex: 8UN não é 32UN) e mesma variação (fragrância, sabor, cor). Nome genérico no cadastro (ex: só "TUBAINA") serve quando a marca/tamanho da nota não contradiz.
- Se dois ou mais candidatos têm nome igual ou quase igual e nada na nota diz qual é (ex: só mudam o código de barras), NÃO escolha: devolva produto_id null com confianca "baixa".
- Se nenhum candidato serve, produto_id null.
- confianca: "alta" quando não há dúvida; "media" quando é provável; "baixa" quando houver dúvida real.
- Devolva uma escolha para cada item, usando o mesmo "indice".`;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const MODEL = "gpt-5.5";

// Foto de nota costuma sair de lado (a folha é paisagem e o celular fica em pé).
// Texto de lado a IA lê bem pior — erra nome de produto. Pergunta a rotação
// olhando uma miniatura (rápido) e gira a foto de verdade antes da leitura.
async function uprightImage(client: OpenAI, dataUrl: string): Promise<string> {
  try {
    const original = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    const thumb = await sharp(original).rotate().resize({ width: 900, height: 900, fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
    const res = await client.chat.completions.create({
      model: MODEL,
      reasoning_effort: "low",
      messages: [
        {
          role: "developer",
          content:
            "Você vê a foto de uma nota fiscal. Diga quantos graus, no sentido horário (0, 90, 180 ou 270), é preciso girar a imagem para que o texto fique de pé e legível, lendo da esquerda para a direita.",
        },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${thumb.toString("base64")}`, detail: "low" } }],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "rotacao",
          strict: true,
          schema: { type: "object", additionalProperties: false, required: ["graus"], properties: { graus: { type: "number", enum: [0, 90, 180, 270] } } },
        },
      },
    });
    const graus = JSON.parse(res.choices[0]?.message?.content ?? "{}").graus as number | undefined;
    if (!graus) return dataUrl;
    const rotated = await sharp(original).rotate().rotate(graus).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${rotated.toString("base64")}`;
  } catch {
    return dataUrl; // se a checagem falhar, lê a foto como veio
  }
}

type ReadItem = NotaItem & { divergencia: string };

async function readNota(client: OpenAI, photos: string[]): Promise<NotaExtraida> {
  const extraction = await client.chat.completions.create({
    model: MODEL,
    reasoning_effort: "low",
    messages: [
      { role: "developer", content: EXTRACTION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Leia os produtos desta nota fiscal." },
          ...photos.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
        ],
      },
    ],
    response_format: { type: "json_schema", json_schema: { name: "nota_fiscal", strict: true, schema: EXTRACTION_SCHEMA } },
  });
  const raw = extraction.choices[0]?.message?.content;
  if (!raw) throw new Error("A IA não devolveu a leitura da nota.");
  return JSON.parse(raw) as NotaExtraida;
}

// A IA lê a nota DUAS vezes, de forma independente. Onde as duas leituras
// concordam, o número é confiável; onde discordam (foto borrada, número
// parecido), a linha vem marcada pra você conferir na foto — é o que impede
// um 3,09 lido como 3,49 de ir pro cadastro sem ninguém ver.
function mergeReadings(a: NotaItem[], b: NotaItem[] | null): ReadItem[] {
  if (!b) return a.map((item) => ({ ...item, divergencia: "" }));
  const onlyOne = "Esse item só apareceu em uma das duas leituras da IA — confira na foto.";
  const used = new Set<number>();
  const merged: ReadItem[] = a.map((item) => {
    let bestIdx = -1;
    let best = 0;
    b.forEach((cand, j) => {
      if (used.has(j)) return;
      const score = descriptionSimilarity(item.descricao, cand.descricao);
      if (score > best) {
        best = score;
        bestIdx = j;
      }
    });
    if (bestIdx < 0 || best < 0.6) return { ...item, divergencia: onlyOne };
    used.add(bestIdx);
    const other = b[bestIdx];
    const same =
      Math.abs(other.quantidade_nota - item.quantidade_nota) < 0.0011 &&
      Math.abs(other.valor_total - item.valor_total) < 0.011 &&
      Math.abs(other.valor_unitario - item.valor_unitario) < 0.011 &&
      Math.abs(other.unidades_por_embalagem - item.unidades_por_embalagem) < 0.0011;
    return same
      ? { ...item, divergencia: "" }
      : { ...item, divergencia: `As duas leituras da IA discordaram (a outra leu ${other.quantidade_nota} × R$ ${other.valor_unitario} = R$ ${other.valor_total}) — confira na foto.` };
  });
  b.forEach((cand, j) => {
    if (!used.has(j)) merged.push({ ...cand, divergencia: onlyOne });
  });
  return merged;
}

async function loadCatalog(storeId: string): Promise<CatalogProduct[]> {
  const admin = getSupabaseAdmin();
  const all: CatalogProduct[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await admin
      .from("products")
      .select("id, name, barcode, price, cost_price, stock, sold_by_weight")
      .eq("store_id", storeId)
      .eq("active", true)
      .range(from, from + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as CatalogProduct[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { store_id?: string; images?: unknown };
  const auth = await authorizeFullAccess(request, body.store_id);
  if ("error" in auth) return auth.error;
  const storeId = body.store_id as string;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Assistente ainda não configurado" }, { status: 500 });

  const images = Array.isArray(body.images) ? (body.images as unknown[]) : [];
  if (images.length === 0 || images.length > MAX_IMAGES) {
    return Response.json({ error: `Mande de 1 a ${MAX_IMAGES} fotos da nota.` }, { status: 400 });
  }
  for (const img of images) {
    if (typeof img !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > MAX_IMAGE_CHARS) {
      return Response.json({ error: "Foto inválida ou grande demais. Tente tirar de novo." }, { status: 400 });
    }
  }

  const client = new OpenAI({ apiKey });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        send({ type: "status", text: "Ajeitando as fotos…" });
        const upright = await Promise.all((images as string[]).map((url) => uprightImage(client, url)));

        send({ type: "status", text: "Lendo a nota (duas vezes, pra conferir)…" });
        const [readA, readB] = await Promise.allSettled([readNota(client, upright), readNota(client, upright)]);
        const first = readA.status === "fulfilled" ? readA.value : readB.status === "fulfilled" ? readB.value : null;
        if (!first) throw new Error("A IA não devolveu a leitura da nota.");
        const second = readA.status === "fulfilled" && readB.status === "fulfilled" ? readB.value : null;
        const nota = { ...first, itens: mergeReadings(first.itens ?? [], second ? (second.itens ?? []) : null) };
        if (nota.itens.length === 0) {
          send({ type: "error", error: "Não consegui ler nenhum produto nessa foto. Tente de novo com a nota mais reta e com boa luz." });
          return;
        }

        send({ type: "status", text: "Procurando os produtos no seu cadastro…" });
        const index = buildIndex(await loadCatalog(storeId));
        const candidatesPerItem = nota.itens.map((item) =>
          topCandidates(`${item.nome_provavel} ${item.descricao}`, index, 8),
        );

        const matchInput = nota.itens.map((item, indice) => ({
          indice,
          descricao_nota: item.descricao,
          nome_provavel: item.nome_provavel,
          candidatos: candidatesPerItem[indice].map((c) => ({ id: c.id, nome: c.name, codigo: c.barcode, preco: c.price })),
        }));
        const matching = await client.chat.completions.create({
          model: MODEL,
          reasoning_effort: "low",
          messages: [
            { role: "developer", content: MATCH_PROMPT },
            { role: "user", content: JSON.stringify(matchInput) },
          ],
          response_format: { type: "json_schema", json_schema: { name: "casamento", strict: true, schema: MATCH_SCHEMA } },
        });
        const matchRaw = matching.choices[0]?.message?.content;
        const escolhas = matchRaw ? (JSON.parse(matchRaw) as { escolhas: { indice: number; produto_id: string | null; confianca: string }[] }).escolhas : [];

        const linhas = nota.itens.map((item, idx) => {
          const candidatos = candidatesPerItem[idx];
          const escolha = escolhas.find((e) => e.indice === idx);
          const chosen = escolha?.produto_id && candidatos.some((c) => c.id === escolha.produto_id) ? escolha.produto_id : null;
          const unidadesPorEmbalagem = item.unidades_por_embalagem > 0 ? item.unidades_por_embalagem : 1;
          const quantidadeReal = Math.round(item.quantidade_nota * unidadesPorEmbalagem * 1000) / 1000;
          const custoUnitario = quantidadeReal > 0 ? round2(item.valor_total / quantidadeReal) : 0;
          const conta = item.quantidade_nota * item.valor_unitario;
          const leituraDuvidosa = Math.abs(conta - item.valor_total) > Math.max(0.05, item.valor_total * 0.01);
          return {
            idx,
            descricao: item.descricao,
            unidade: item.unidade,
            quantidade_nota: item.quantidade_nota,
            unidades_por_embalagem: unidadesPorEmbalagem,
            quantidade_real: quantidadeReal,
            valor_total: item.valor_total,
            custo_unitario: custoUnitario,
            divergente: Boolean(item.divergencia) || leituraDuvidosa,
            observacao: [item.observacao, item.divergencia, leituraDuvidosa ? "Quantidade × valor unitário não bate com o total da linha — confira a leitura." : ""]
              .filter(Boolean)
              .join(" "),
            produto_id: chosen,
            confianca: chosen ? (escolha?.confianca ?? "media") : "baixa",
            candidatos,
          };
        });

        const somaItens = round2(nota.itens.reduce((s, i) => s + i.valor_total, 0));
        const aviso =
          nota.total_nota != null && Math.abs(somaItens - nota.total_nota) > 0.5
            ? `A soma dos itens (R$ ${somaItens.toFixed(2).replace(".", ",")}) não bate com o total da nota (R$ ${nota.total_nota.toFixed(2).replace(".", ",")}). Pode ter ficado item de fora ou número mal lido.`
            : null;

        send({
          type: "done",
          result: {
            nota: { fornecedor: nota.fornecedor, numero: nota.numero_nota, total: nota.total_nota, soma_itens: somaItens, aviso },
            linhas,
          },
        });
      } catch (err) {
        console.error("Leitura de nota falhou:", err instanceof Error ? err.message : err);
        send({ type: "error", error: "Não deu pra ler a nota agora. Tente de novo em instantes, ou com uma foto mais nítida." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
