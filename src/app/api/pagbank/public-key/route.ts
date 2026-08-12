import "server-only";

// O navegador do cliente usa essa chave pública pra criptografar o cartão
// antes de mandar pro nosso servidor — o número/CVV nunca trafegam sem
// estarem criptografados, e nosso servidor nunca vê o cartão em texto puro.
export async function POST() {
  const token = process.env.PAGBANK_TOKEN;
  if (!token) {
    return Response.json({ error: "Pagamento não configurado" }, { status: 500 });
  }

  const res = await fetch("https://api.pagseguro.com/public-keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "card" }),
  });

  const data = await res.json();
  if (!res.ok) {
    return Response.json({ error: "Não deu pra preparar o pagamento", details: data }, { status: 502 });
  }

  return Response.json({ public_key: data.public_key });
}
