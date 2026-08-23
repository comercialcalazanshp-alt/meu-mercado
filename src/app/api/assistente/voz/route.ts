import "server-only";
import OpenAI from "openai";

// Converte o texto da resposta do assistente em áudio (voz natural da
// OpenAI, bem melhor que a voz sintética do navegador). Só exige estar
// autenticado — não precisa validar dono da loja aqui porque o texto já
// veio de uma resposta que o próprio painel do dono gerou.
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Voz ainda não configurada" }, { status: 500 });
  }

  const { text } = (await request.json()) as { text?: string };
  if (!text?.trim()) {
    return Response.json({ error: "Faltou o texto" }, { status: 400 });
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
