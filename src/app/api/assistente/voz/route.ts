import "server-only";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// Converte o texto da resposta do assistente em áudio (voz natural da
// OpenAI, bem melhor que a voz sintética do navegador). Exige store_id +
// a mesma checagem de plano do chat — senão um afiliado sem o extra
// "Assistente de IA" ligado poderia gerar áudio à toa, gastando a chave
// da OpenAI do Hub sem pagar por isso.
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Voz ainda não configurada" }, { status: 500 });
  }

  const { text, store_id } = (await request.json()) as { text?: string; store_id?: string };
  if (!text?.trim() || !store_id) {
    return Response.json({ error: "Faltou o texto ou a loja" }, { status: 400 });
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

  const { data: enabled } = await scoped.rpc("affiliate_assistant_enabled", { p_store_id: store_id });
  if (!enabled) {
    return Response.json({ error: "Esse recurso não está incluído no seu plano." }, { status: 402 });
  }

  const client = new OpenAI({ apiKey });

  try {
    const speech = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: text.trim().slice(0, 4000),
    });

    const buffer = Buffer.from(await speech.arrayBuffer());
    return new Response(buffer, { headers: { "Content-Type": "audio/mpeg" } });
  } catch (err) {
    console.error("Voz do assistente falhou:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Não deu pra gerar a voz agora" }, { status: 502 });
  }
}
