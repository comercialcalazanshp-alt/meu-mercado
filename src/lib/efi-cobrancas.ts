import "server-only";
import https from "node:https";
import { getEfiAgent } from "@/lib/efi-pix";

// Cliente da API Cobranças da Efí (boleto) — mesma conta/certificado da API
// Pix (efi-pix.ts), mas base e endpoints diferentes: autentica em
// /v1/authorize (Basic client_id:client_secret) e cria cobrança em
// /v1/charge/one-step.
const COBRANCAS_BASE_URL = process.env.EFI_SANDBOX === "true" ? "https://cobrancas-h.api.efipay.com.br" : "https://cobrancas.api.efipay.com.br";

function cobrancasRequest<T>(method: string, path: string, body: unknown, authHeader: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const url = new URL(`${COBRANCAS_BASE_URL}${path}`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        agent: getEfiAgent(),
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
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
            reject(Object.assign(new Error("Efí Cobranças request failed"), { status: res.statusCode, body: json }));
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
  const data = await cobrancasRequest<{ access_token: string; expires_in: number }>(
    "POST",
    "/v1/authorize",
    { grant_type: "client_credentials" },
    `Basic ${basic}`,
  );
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

export type BoletoCustomer = {
  name: string;
  taxId: string; // CPF (11) ou CNPJ (14) só dígitos
  email: string;
  phone: string; // só dígitos, com DDD
  cep: string; // só dígitos
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string; // UF, 2 letras
  complement?: string;
};

export async function createEfiBoleto(params: {
  description: string;
  amount: number;
  expireInDays: number;
  customer: BoletoCustomer;
}): Promise<{ chargeId: number; barcode: string; pdfUrl: string; expireAt: string }> {
  const token = await getAccessToken();
  const expireAt = new Date(Date.now() + params.expireInDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const customerField = params.customer.taxId.length === 14 ? { cnpj: params.customer.taxId } : { cpf: params.customer.taxId };

  const data = await cobrancasRequest<{
    data: { charge_id: number; barcode: string; pdf: { charge: string }; expire_at: string };
  }>(
    "POST",
    "/v1/charge/one-step",
    {
      items: [{ name: params.description.slice(0, 60), value: Math.round(params.amount * 100), amount: 1 }],
      payment: {
        banking_billet: {
          customer: {
            name: params.customer.name,
            ...customerField,
            email: params.customer.email,
            phone_number: params.customer.phone,
            address: {
              street: params.customer.street,
              number: params.customer.number,
              neighborhood: params.customer.neighborhood,
              zipcode: params.customer.cep,
              city: params.customer.city,
              state: params.customer.state,
              complement: params.customer.complement ?? "",
            },
          },
          expire_at: expireAt,
          configurations: { fine: 0, interest: 0, days_to_write_off: 30 },
        },
      },
    },
    `Bearer ${token}`,
  );

  return { chargeId: data.data.charge_id, barcode: data.data.barcode, pdfUrl: data.data.pdf.charge, expireAt: data.data.expire_at };
}

// Sem webhook confirmado pra Cobranças ainda — confirmação é sob demanda,
// reconsultando a cobrança direto na Efí (mesmo princípio de segurança do
// webhook do Pix: nunca confiar em aviso externo sem checar na fonte).
export async function getEfiChargeStatus(chargeId: number): Promise<string> {
  const token = await getAccessToken();
  const data = await cobrancasRequest<{ data: { status: string } }>("GET", `/v1/charge/${chargeId}`, null, `Bearer ${token}`);
  return data.data.status;
}
