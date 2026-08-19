import "server-only";
import { createClient } from "@supabase/supabase-js";

// Gera uma imagem via IA (OpenAI) pra qualquer módulo do painel (kits,
// receitas, banners...). O dono escreve/edita o texto que descreve a
// imagem, e pode escolher fotos (do catálogo ou tiradas na hora) pra
// servirem de referência — nesse caso usamos o endpoint de edição
// (gpt-image-1 aceita várias imagens de entrada), que reaproveita/recompõe
// as fotos de verdade em vez de só descrever em texto. Sem referência, cai
// pro endpoint de geração normal a partir só do texto. Fica no servidor
// porque a chave da OpenAI não pode vazar pro navegador, e porque
// precisamos confirmar que quem pediu é dono da loja antes de gastar
// crédito da API.
export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Geração de imagem por IA não configurada ainda" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const {
    store_id,
    prompt,
    reference_image_urls,
    prefix,
    size,
  } = (await request.json()) as {
    store_id: string;
    prompt: string;
    reference_image_urls?: string[];
    prefix?: string;
    size?: "1024x1024" | "1536x1024" | "1024x1536";
  };

  if (!store_id || !prompt?.trim()) {
    return Response.json({ error: "Faltou o texto descrevendo a imagem" }, { status: 400 });
  }

  const imageSize = size === "1536x1024" || size === "1024x1536" ? size : "1024x1024";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: myStoreIds, error: storeIdsError } = await scoped.rpc("my_store_ids");
  if (storeIdsError || !myStoreIds?.some((id: string) => id === store_id)) {
    return Response.json({ error: "Essa loja não é sua" }, { status: 403 });
  }

  const refUrls = (reference_image_urls ?? []).slice(0, 6);
  const kind = refUrls.length > 0 ? "editada" : "gerada";

  // Só lojas afiliadas de um Hub têm cota — loja comum (ou o próprio Hub)
  // gera sem limite. Checa e já registra o uso numa função só (evita corrida
  // entre duas gerações simultâneas passando as duas pela checagem).
  const { data: partnershipRows } = await scoped
    .from("affiliate_partnerships")
    .select("id")
    .eq("module_store_id", store_id)
    .eq("active", true)
    .limit(1);
  const partnershipId = partnershipRows?.[0]?.id as string | undefined;

  if (partnershipId) {
    const { error: quotaError } = await scoped.rpc("affiliate_generate_ai_image", {
      p_partnership_id: partnershipId,
      p_kind: kind,
    });
    if (quotaError) {
      return Response.json(
        { error: "Cota de imagens do mês esgotada. Vá em Parceria no menu pra comprar um pacote extra." },
        { status: 402 },
      );
    }
  }

  let genRes: Response;
  if (refUrls.length > 0) {
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt.trim());
    form.append("size", imageSize);
    form.append("quality", "medium");
    for (const url of refUrls) {
      try {
        const imgRes = await fetch(url);
        if (!imgRes.ok) continue;
        const blob = await imgRes.blob();
        form.append("image[]", blob, "referencia.jpg");
      } catch {
        // ignora essa referência e segue com as outras
      }
    }
    genRes = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    genRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: prompt.trim(),
        size: imageSize,
        quality: "medium",
        n: 1,
      }),
    });
  }

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
  const safePrefix = (prefix || "img").replace(/[^a-z0-9-]/gi, "");
  const path = `${store_id}/${safePrefix}-${crypto.randomUUID()}.png`;
  const { error: uploadError } = await scoped.storage
    .from("product-images")
    .upload(path, bytes, { contentType: "image/png" });

  if (uploadError) {
    return Response.json({ error: "Gerou a imagem, mas não deu pra salvar: " + uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = scoped.storage.from("product-images").getPublicUrl(path);
  return Response.json({ image_url: publicUrlData.publicUrl });
}
