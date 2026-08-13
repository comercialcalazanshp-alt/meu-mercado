import "server-only";
import { createClient } from "@supabase/supabase-js";

// Gera uma foto de produto pro kit via IA (OpenAI) a partir do nome do kit e
// dos produtos que tem dentro, e já salva no mesmo bucket de fotos de
// produto. Fica no servidor porque a chave da OpenAI não pode vazar pro
// navegador, e porque precisamos confirmar que quem pediu é dono da loja
// antes de gastar crédito da API gerando imagem.
export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Geração de imagem por IA não configurada ainda" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { store_id, kit_name, product_names } = (await request.json()) as {
    store_id: string;
    kit_name: string;
    product_names: string[];
  };

  if (!store_id || !kit_name?.trim()) {
    return Response.json({ error: "Faltou o nome do kit" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: myStoreIds, error: storeIdsError } = await scoped.rpc("my_store_ids");
  if (storeIdsError || !myStoreIds?.some((id: string) => id === store_id)) {
    return Response.json({ error: "Essa loja não é sua" }, { status: 403 });
  }

  const itemsList = product_names.filter((n) => n.trim()).join(", ");
  const prompt = [
    `Foto de produto realista, estilo comercial de supermercado, mostrando um kit/cesta chamado "${kit_name.trim()}".`,
    itemsList ? `Contém: ${itemsList}.` : "",
    "Itens organizados de forma atraente, fundo neutro claro, iluminação de estúdio, sem texto, sem logotipos, sem marcas d'água.",
  ]
    .filter(Boolean)
    .join(" ");

  const genRes = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "medium",
      n: 1,
    }),
  });

  const genData = await genRes.json();
  if (!genRes.ok) {
    console.error("OpenAI image generation failed:", JSON.stringify(genData));
    return Response.json({ error: "Não deu pra gerar a imagem" }, { status: 502 });
  }

  const b64 = genData.data?.[0]?.b64_json;
  if (!b64) {
    return Response.json({ error: "A IA não devolveu nenhuma imagem" }, { status: 502 });
  }

  const bytes = Buffer.from(b64, "base64");
  const path = `${store_id}/kit-${crypto.randomUUID()}.png`;
  const { error: uploadError } = await scoped.storage
    .from("product-images")
    .upload(path, bytes, { contentType: "image/png" });

  if (uploadError) {
    return Response.json({ error: "Gerou a imagem, mas não deu pra salvar: " + uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = scoped.storage.from("product-images").getPublicUrl(path);
  return Response.json({ image_url: publicUrlData.publicUrl });
}
