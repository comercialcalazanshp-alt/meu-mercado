import "server-only";
import https from "node:https";

// Cliente da API Pix da Efí (ex-Gerencianet). Diferente do PagBank, a Efí
// autentica com certificado (mTLS) em vez de só um token de texto — por
// isso não dá pra usar o fetch nativo direto (não expõe pfx/certificado
// cliente), e a chamada é feita via https.request com um Agent próprio.
const EFI_BASE_URL = process.env.EFI_SANDBOX === "true" ? "https://pix-h.api.efipay.com.br" : "https://pix.api.efipay.com.br";

function isConfigured() {
  return !!(process.env.EFI_CLIENT_ID && process.env.EFI_CLIENT_SECRET && process.env.EFI_CERTIFICATE_BASE64 && process.env.EFI_PIX_KEY);
}

let cachedAgent: https.Agent | null = null;
function getAgent(): https.Agent {
  if (cachedAgent) return cachedAgent;
  const certBase64 = process.env.EFI_CERTIFICATE_BASE64;
  if (!certBase64) throw new Error("EFI_CERTIFICATE_BASE64 não configurado");
  cachedAgent = new https.Agent({
    pfx: Buffer.from(certBase64, "base64"),
    passphrase: process.env.EFI_CERTIFICATE_PASSWORD || undefined,
  });
  return cachedAgent;
}

function efiRequest<T>(
  method: string,
  path: string,
  body: unknown,
  authHeader: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const url = new URL(`${EFI_BASE_URL}${path}`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        agent: getAgent(),
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          ...extraHeaders,
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let json: unknown = {};
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch {
            // resposta sem corpo JSON — segue com objeto vazio
          }
          if ((res.statusCode ?? 500) >= 400) {
            reject(Object.assign(new Error("Efí request failed"), { status: res.statusCode, body: json }));
          } else {
            resolve(json as T);
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const clientId = process.env.EFI_CLIENT_ID!;
  const clientSecret = process.env.EFI_CLIENT_SECRET!;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const data = await efiRequest<{ access_token: string; expires_in: number }>(
    "POST",
    "/oauth/token",
    { grant_type: "client_credentials" },
    `Basic ${basic}`,
  );
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

// txid tem que ter entre 26 e 35 caracteres alfanuméricos (regra da Efí) —
// um uuid sem os hífens tem exatamente 32, cabe certinho.
export function makeTxid(recordId: string) {
  return recordId.replace(/-/g, "").slice(0, 32);
}

export async function createEfiPixCharge(params: {
  txid: string;
  amount: number;
  customerName: string;
  customerTaxId: string; // CPF (11) ou CNPJ (14) só dígitos — a Efí quer campos diferentes pra cada um
  description: string;
}): Promise<{ txid: string; qrCodeText: string; qrCodeImage: string }> {
  if (!isConfigured()) {
    throw new Error("Pix (Efí) ainda não configurado — faltam as variáveis de ambiente");
  }
  const token = await getAccessToken();
  const pixKey = process.env.EFI_PIX_KEY!;
  const devedor =
    params.customerTaxId.length === 14
      ? { cnpj: params.customerTaxId, nome: params.customerName }
      : { cpf: params.customerTaxId, nome: params.customerName };

  const cob = await efiRequest<{ txid: string; loc: { id: number } }>(
    "PUT",
    `/v2/cob/${params.txid}`,
    {
      calendario: { expiracao: 3600 },
      devedor,
      valor: { original: params.amount.toFixed(2) },
      chave: pixKey,
      solicitacaoPagador: params.description.slice(0, 140),
    },
    `Bearer ${token}`,
  );

  const qr = await efiRequest<{ qrcode: string; imagemQrcode: string }>(
    "GET",
    `/v2/loc/${cob.loc.id}/qrcode`,
    null,
    `Bearer ${token}`,
  );

  return { txid: cob.txid, qrCodeText: qr.qrcode, qrCodeImage: qr.imagemQrcode };
}

// A notificação que a Efí manda pro webhook não vem assinada — a forma seg-
// ura de confirmar é reconsultar a cobrança direto na API (com nossas
// próprias credenciais) em vez de confiar cegamente no corpo da chamada.
// Devolve também o endToEndId de cada Pix recebido pra essa cobrança —
// é o identificador que a devolução (estorno) exige depois.
export async function getEfiPixChargeDetail(
  txid: string,
): Promise<{ status: string; pix: { endToEndId: string; valor: string }[] }> {
  const token = await getAccessToken();
  return efiRequest("GET", `/v2/cob/${txid}`, null, `Bearer ${token}`);
}

export async function getEfiPixChargeStatus(txid: string): Promise<string> {
  return (await getEfiPixChargeDetail(txid)).status;
}

// Devolve (total ou parcialmente) um Pix já recebido. p_refund_id é gerado
// por nós (identifica essa devolução específica, não a cobrança original)
// — reaproveita makeTxid pra gerar algo no formato certo.
export async function refundEfiPix(endToEndId: string, refundId: string, amount: number): Promise<{ status: string }> {
  const token = await getAccessToken();
  return efiRequest("PUT", `/v2/pix/${endToEndId}/devolucao/${refundId}`, { valor: amount.toFixed(2) }, `Bearer ${token}`);
}

// Registro do webhook — só precisa rodar uma vez (ou de novo se a URL
// mudar). Chamado pela rota /api/efi/register-webhook.
export async function registerEfiWebhook(webhookUrl: string): Promise<void> {
  const token = await getAccessToken();
  const pixKey = process.env.EFI_PIX_KEY!;
  // Nosso endpoint de webhook não valida certificado de cliente (mTLS) na
  // ponta de recebimento — sem esse header a Efí recusa o registro exigindo
  // autenticação mútua na URL informada.
  await efiRequest("PUT", `/v2/webhook/${pixKey}`, { webhookUrl }, `Bearer ${token}`, { "x-skip-mtls-checking": "true" });
}

export { isConfigured as isEfiConfigured };
