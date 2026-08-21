"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import type { AffiliatePartnership, AffiliateAiPackage, AffiliateAiPurchase } from "@/lib/affiliate-types";

function formatCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

const BILLING_LABEL: Record<string, string> = { mensal: "mensal", trimestral: "trimestral", semestral: "semestral", anual: "anual" };

type PixState = { qrText: string | null; qrImage: string | null; kind: "mensalidade" | "pacote"; recordId: string; table: string } | null;
type BoletoState = {
  barcode: string;
  pdfUrl: string;
  expireAt: string;
  kind: "mensalidade" | "pacote";
  recordId: string;
  table: "affiliate_subscription_payments" | "affiliate_ai_purchases";
} | null;

const emptyBillingForm = {
  billing_email: "",
  billing_phone: "",
  billing_cep: "",
  billing_street: "",
  billing_number: "",
  billing_neighborhood: "",
  billing_city: "",
  billing_state: "",
  billing_complement: "",
};

export default function Parceria() {
  const store = useStore();
  const [partnership, setPartnership] = useState<AffiliatePartnership | null>(null);
  const [hubName, setHubName] = useState("");
  const [aiUsed, setAiUsed] = useState(0);
  const [aiQuotaDefault, setAiQuotaDefault] = useState(5);
  const [packages, setPackages] = useState<AffiliateAiPackage[]>([]);
  const [purchases, setPurchases] = useState<AffiliateAiPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pix, setPix] = useState<PixState>(null);
  const [pixPaid, setPixPaid] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  const [boleto, setBoleto] = useState<BoletoState>(null);
  const [billingForm, setBillingForm] = useState(emptyBillingForm);
  const [savingBilling, setSavingBilling] = useState(false);
  const [billingSaved, setBillingSaved] = useState(false);
  const [checkingBoleto, setCheckingBoleto] = useState(false);
  const [boletoJustPaid, setBoletoJustPaid] = useState(false);

  async function loadAll() {
    const supabase = getSupabase();
    const { data: rows } = await supabase.from("affiliate_partnerships").select("*").eq("module_store_id", store.id).eq("active", true).limit(1);
    const p = (rows?.[0] as AffiliatePartnership) ?? null;
    setPartnership(p);
    if (!p) {
      setLoading(false);
      return;
    }
    setBillingForm({
      billing_email: p.billing_email ?? "",
      billing_phone: p.billing_phone ?? "",
      billing_cep: p.billing_cep ?? "",
      billing_street: p.billing_street ?? "",
      billing_number: p.billing_number ?? "",
      billing_neighborhood: p.billing_neighborhood ?? "",
      billing_city: p.billing_city ?? "",
      billing_state: p.billing_state ?? "",
      billing_complement: p.billing_complement ?? "",
    });

    const [hubRes, settingsRes, usedRes, packagesRes, purchasesRes] = await Promise.all([
      supabase.from("stores").select("name").eq("id", p.hub_store_id).maybeSingle(),
      supabase.from("affiliate_settings").select("ai_quota_monthly_default").eq("hub_store_id", p.hub_store_id).maybeSingle(),
      supabase
        .from("affiliate_ai_image_events")
        .select("id", { count: "exact", head: true })
        .eq("partnership_id", p.id)
        .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
      supabase
        .from("affiliate_ai_packages")
        .select("*")
        .eq("active", true)
        .or(`partnership_id.eq.${p.id},partnership_id.is.null`)
        .eq("hub_store_id", p.hub_store_id),
      supabase.from("affiliate_ai_purchases").select("*").eq("partnership_id", p.id).order("created_at", { ascending: false }).limit(10),
    ]);

    setHubName(hubRes.data?.name ?? "Hub");
    setAiQuotaDefault(settingsRes.data?.ai_quota_monthly_default ?? 5);
    setAiUsed(usedRes.count ?? 0);
    setPackages((packagesRes.data as AffiliateAiPackage[]) ?? []);
    setPurchases((purchasesRes.data as AffiliateAiPurchase[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  // Fica checando se o Pix caiu — mesmo padrão já usado na vitrine
  // (storefront-client.tsx) pro pedido do cliente final.
  useEffect(() => {
    if (!pix || pixPaid) return;
    const interval = setInterval(async () => {
      const supabase = getSupabase();
      const { data } = await supabase.from(pix.table).select("paid_at").eq("id", pix.recordId).maybeSingle();
      if (data?.paid_at) {
        setPixPaid(true);
        clearInterval(interval);
        setTimeout(() => {
          setPix(null);
          setPixPaid(false);
          loadAll();
        }, 2500);
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pix, pixPaid]);

  const quota = partnership?.ai_quota_monthly ?? aiQuotaDefault;
  const now = new Date();
  const purchasedThisMonth = useMemo(
    () =>
      purchases
        .filter((pu) => pu.paid_at && new Date(pu.paid_at).getMonth() === now.getMonth() && new Date(pu.paid_at).getFullYear() === now.getFullYear())
        .reduce((s, pu) => s + pu.image_qty, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [purchases],
  );
  const totalQuota = quota + purchasedThisMonth;
  const quotaFull = aiUsed >= totalQuota;

  const isOverdue = partnership?.subscription_due_at && new Date(partnership.subscription_due_at) < now;

  async function authHeader() {
    const { data } = await getSupabase().auth.getSession();
    return `Bearer ${data.session?.access_token ?? ""}`;
  }

  async function pagarMensalidade() {
    if (!partnership) return;
    setError(null);
    setGenerating("mensalidade");
    try {
      const res = await fetch("/api/efi/create-subscription-pix", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: await authHeader() },
        body: JSON.stringify({ partnership_id: partnership.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Não deu pra gerar o Pix");
        return;
      }
      setPixPaid(false);
      setPix({ qrText: data.qr_code_text, qrImage: data.qr_code_image, kind: "mensalidade", recordId: "", table: "affiliate_subscription_payments" });
      // A resposta não devolve o id da cobrança — busca a mais recente
      // dessa parceria pra poder acompanhar o pagamento.
      const { data: latest } = await getSupabase()
        .from("affiliate_subscription_payments")
        .select("id")
        .eq("partnership_id", partnership.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) setPix((prev) => (prev ? { ...prev, recordId: latest.id } : prev));
    } finally {
      setGenerating(null);
    }
  }

  async function comprarPacote(pkg: AffiliateAiPackage) {
    if (!partnership) return;
    setError(null);
    setGenerating(pkg.id);
    try {
      const res = await fetch("/api/efi/create-package-pix", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: await authHeader() },
        body: JSON.stringify({ partnership_id: partnership.id, package_id: pkg.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Não deu pra gerar o Pix");
        return;
      }
      setPixPaid(false);
      const { data: latest } = await getSupabase()
        .from("affiliate_ai_purchases")
        .select("id")
        .eq("partnership_id", partnership.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setPix({
        qrText: data.qr_code_text,
        qrImage: data.qr_code_image,
        kind: "pacote",
        recordId: latest?.id ?? "",
        table: "affiliate_ai_purchases",
      });
    } finally {
      setGenerating(null);
    }
  }

  async function saveBillingInfo() {
    if (!partnership) return;
    setSavingBilling(true);
    setBillingSaved(false);
    setError(null);
    const { error: rpcError } = await getSupabase().rpc("update_affiliate_billing_info", {
      p_partnership_id: partnership.id,
      p_billing_email: billingForm.billing_email,
      p_billing_phone: billingForm.billing_phone,
      p_billing_cep: billingForm.billing_cep,
      p_billing_street: billingForm.billing_street,
      p_billing_number: billingForm.billing_number,
      p_billing_neighborhood: billingForm.billing_neighborhood,
      p_billing_city: billingForm.billing_city,
      p_billing_state: billingForm.billing_state,
      p_billing_complement: billingForm.billing_complement,
    });
    setSavingBilling(false);
    if (rpcError) {
      setError("Não deu pra salvar os dados de cobrança.");
      return;
    }
    setBillingSaved(true);
    loadAll();
  }

  const billingComplete =
    billingForm.billing_email.trim() &&
    billingForm.billing_phone.trim() &&
    billingForm.billing_cep.trim() &&
    billingForm.billing_street.trim() &&
    billingForm.billing_number.trim() &&
    billingForm.billing_neighborhood.trim() &&
    billingForm.billing_city.trim() &&
    billingForm.billing_state.trim();

  async function pagarMensalidadeBoleto() {
    if (!partnership) return;
    setError(null);
    setGenerating("mensalidade-boleto");
    try {
      const res = await fetch("/api/efi/create-subscription-boleto", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: await authHeader() },
        body: JSON.stringify({ partnership_id: partnership.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Não deu pra gerar o boleto");
        return;
      }
      setBoletoJustPaid(false);
      setBoleto({ barcode: data.barcode, pdfUrl: data.pdf_url, expireAt: data.expire_at, kind: "mensalidade", recordId: data.record_id, table: "affiliate_subscription_payments" });
    } finally {
      setGenerating(null);
    }
  }

  async function comprarPacoteBoleto(pkg: AffiliateAiPackage) {
    if (!partnership) return;
    setError(null);
    setGenerating(`${pkg.id}-boleto`);
    try {
      const res = await fetch("/api/efi/create-package-boleto", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: await authHeader() },
        body: JSON.stringify({ partnership_id: partnership.id, package_id: pkg.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Não deu pra gerar o boleto");
        return;
      }
      setBoletoJustPaid(false);
      setBoleto({ barcode: data.barcode, pdfUrl: data.pdf_url, expireAt: data.expire_at, kind: "pacote", recordId: data.record_id, table: "affiliate_ai_purchases" });
    } finally {
      setGenerating(null);
    }
  }

  async function checkBoletoPaid() {
    if (!boleto) return;
    setCheckingBoleto(true);
    try {
      const res = await fetch("/api/efi/check-boleto-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: await authHeader() },
        body: JSON.stringify({ table: boleto.table, record_id: boleto.recordId }),
      });
      const data = await res.json();
      if (res.ok && data.paid) {
        setBoletoJustPaid(true);
        setTimeout(() => {
          setBoleto(null);
          setBoletoJustPaid(false);
          loadAll();
        }, 2500);
      } else if (!res.ok) {
        setError(data.error || "Não deu pra verificar o boleto");
      }
    } finally {
      setCheckingBoleto(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-white/40">Carregando…</div>;
  }

  if (!partnership) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Parceria</h1>
        <p className="mt-2 text-sm text-white/40">Sua loja ainda não está ligada a nenhum Hub como afiliada.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-white">Parceria com {hubName}</h1>
      <p className="mt-1 text-sm text-white/40">
        {partnership.category} · comissão de {partnership.commission_percent}% pro Hub em cada venda
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      <div className="mt-4 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-white/30">Mensalidade</p>
        {partnership.subscription_price ? (
          <>
            <p className="mt-1 text-xl font-bold text-white">
              {formatCurrency(partnership.subscription_price)}{" "}
              <span className="text-sm font-normal text-white/30">/ {BILLING_LABEL[partnership.billing_cycle] ?? partnership.billing_cycle}</span>
            </p>
            {partnership.subscription_due_at && (
              <p className={`mt-0.5 text-sm ${isOverdue ? "font-semibold text-red-600 dark:text-red-400" : "text-white/40"}`}>
                {isOverdue ? "Venceu em" : "Vence em"} {formatDate(partnership.subscription_due_at)}
                {isOverdue ? " — atrasada" : ""}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={pagarMensalidade}
                disabled={generating === "mensalidade"}
                className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-50 dark:bg-blue-800"
              >
                {generating === "mensalidade" ? "Gerando Pix…" : "Pagar via Pix"}
              </button>
              <button
                onClick={pagarMensalidadeBoleto}
                disabled={generating === "mensalidade-boleto" || !billingComplete}
                title={!billingComplete ? "Preencha seus dados de cobrança abaixo primeiro" : undefined}
                className="rounded-lg border border-white/[0.14] px-4 py-2 text-sm font-semibold text-white/70 disabled:opacity-40"
              >
                {generating === "mensalidade-boleto" ? "Gerando boleto…" : "Pagar via Boleto"}
              </button>
            </div>
            {!billingComplete && (
              <p className="mt-1.5 text-xs text-white/30">Pra pagar via boleto, preencha seus dados de cobrança abaixo.</p>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-white/40">Sem mensalidade configurada.</p>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-white/30">Cota de imagem por IA</p>
          <span className={`text-sm font-semibold ${quotaFull ? "text-red-600 dark:text-red-400" : "text-white/40"}`}>
            {aiUsed} de {totalQuota} usadas
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className={`h-full rounded-full ${quotaFull ? "bg-red-600" : "bg-blue-900"}`}
            style={{ width: `${totalQuota > 0 ? Math.min(100, (aiUsed / totalQuota) * 100) : 0}%` }}
          />
        </div>
        {packages.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {packages.map((pkg) => (
              <div key={pkg.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-3 py-2">
                <span className="text-sm text-white/60">+{pkg.qty} imagens — {formatCurrency(pkg.price)}</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => comprarPacote(pkg)}
                    disabled={generating === pkg.id}
                    className="rounded-lg border border-[#F0BB5E]/40 px-3 py-1 text-xs font-semibold text-[#F0BB5E] disabled:opacity-50"
                  >
                    {generating === pkg.id ? "Gerando…" : "Pix"}
                  </button>
                  <button
                    onClick={() => comprarPacoteBoleto(pkg)}
                    disabled={generating === `${pkg.id}-boleto` || !billingComplete}
                    title={!billingComplete ? "Preencha seus dados de cobrança abaixo primeiro" : undefined}
                    className="rounded-lg border border-white/[0.14] px-3 py-1 text-xs font-semibold text-white/70 disabled:opacity-40"
                  >
                    {generating === `${pkg.id}-boleto` ? "Gerando…" : "Boleto"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-white/30">Dados de cobrança</p>
        <p className="mt-0.5 text-xs text-white/40">Necessário só pra gerar boleto (o Pix não precisa disso).</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input
            value={billingForm.billing_email}
            onChange={(e) => setBillingForm((p) => ({ ...p, billing_email: e.target.value }))}
            placeholder="E-mail"
            className="col-span-2 rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <input
            value={billingForm.billing_phone}
            onChange={(e) => setBillingForm((p) => ({ ...p, billing_phone: e.target.value }))}
            placeholder="Telefone (DDD + número)"
            className="col-span-2 rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <input
            value={billingForm.billing_cep}
            onChange={(e) => setBillingForm((p) => ({ ...p, billing_cep: e.target.value }))}
            placeholder="CEP"
            className="rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <input
            value={billingForm.billing_state}
            onChange={(e) => setBillingForm((p) => ({ ...p, billing_state: e.target.value.toUpperCase().slice(0, 2) }))}
            placeholder="UF"
            className="rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <input
            value={billingForm.billing_street}
            onChange={(e) => setBillingForm((p) => ({ ...p, billing_street: e.target.value }))}
            placeholder="Rua"
            className="col-span-2 rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <input
            value={billingForm.billing_number}
            onChange={(e) => setBillingForm((p) => ({ ...p, billing_number: e.target.value }))}
            placeholder="Número"
            className="rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <input
            value={billingForm.billing_complement}
            onChange={(e) => setBillingForm((p) => ({ ...p, billing_complement: e.target.value }))}
            placeholder="Complemento (opcional)"
            className="rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <input
            value={billingForm.billing_neighborhood}
            onChange={(e) => setBillingForm((p) => ({ ...p, billing_neighborhood: e.target.value }))}
            placeholder="Bairro"
            className="rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <input
            value={billingForm.billing_city}
            onChange={(e) => setBillingForm((p) => ({ ...p, billing_city: e.target.value }))}
            placeholder="Cidade"
            className="rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
        </div>
        <button
          onClick={saveBillingInfo}
          disabled={savingBilling}
          className="mt-3 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-50 dark:bg-blue-800"
        >
          {savingBilling ? "Salvando…" : billingSaved ? "Salvo ✓" : "Salvar dados de cobrança"}
        </button>
      </div>

      {pix && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !pixPaid && setPix(null)}>
          <div
            className="w-full max-w-xs rounded-2xl bg-black border border-white/[0.12] p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {pixPaid ? (
              <>
                <p className="text-3xl">✅</p>
                <p className="mt-2 font-semibold text-white">Pago!</p>
              </>
            ) : (
              <>
                <p className="mb-2 text-sm font-semibold text-white">
                  {pix.kind === "mensalidade" ? "Pague sua mensalidade" : "Pague seu pacote"}
                </p>
                {pix.qrImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pix.qrImage} alt="QR Code Pix" className="mx-auto h-48 w-48" />
                )}
                {pix.qrText && (
                  <button
                    onClick={() => navigator.clipboard.writeText(pix.qrText as string)}
                    className="mt-2 w-full truncate rounded-lg border border-white/[0.14] px-2 py-1.5 text-[11px] text-white/40"
                  >
                    {pix.qrText.slice(0, 40)}… (copiar código)
                  </button>
                )}
                <p className="mt-3 text-xs text-white/30">Aguardando confirmação…</p>
                <button onClick={() => setPix(null)} className="mt-3 text-xs font-medium text-white/40 hover:text-white/70">
                  Fechar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {boleto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !boletoJustPaid && setBoleto(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-black border border-white/[0.12] p-5 text-center" onClick={(e) => e.stopPropagation()}>
            {boletoJustPaid ? (
              <>
                <p className="text-3xl">✅</p>
                <p className="mt-2 font-semibold text-white">Pago!</p>
              </>
            ) : (
              <>
                <p className="mb-2 text-sm font-semibold text-white">
                  {boleto.kind === "mensalidade" ? "Boleto da mensalidade" : "Boleto do pacote"}
                </p>
                <p className="text-xs text-white/40">Vence em {formatDate(boleto.expireAt)}</p>
                <button
                  onClick={() => navigator.clipboard.writeText(boleto.barcode)}
                  className="mt-3 w-full truncate rounded-lg border border-white/[0.14] px-2 py-1.5 text-[11px] text-white/40"
                >
                  {boleto.barcode.slice(0, 30)}… (copiar código de barras)
                </button>
                <a
                  href={boleto.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block w-full rounded-lg bg-blue-900 px-3 py-2 text-sm font-semibold text-amber-300 dark:bg-blue-800"
                >
                  Abrir PDF do boleto
                </a>
                <button
                  onClick={checkBoletoPaid}
                  disabled={checkingBoleto}
                  className="mt-3 w-full rounded-lg border border-[#F0BB5E]/40 px-3 py-2 text-sm font-semibold text-[#F0BB5E] disabled:opacity-50"
                >
                  {checkingBoleto ? "Verificando…" : "Já paguei, verificar"}
                </button>
                <p className="mt-2 text-[11px] text-white/25">O boleto pode levar até 1-2 dias úteis pra compensar.</p>
                <button onClick={() => setBoleto(null)} className="mt-3 text-xs font-medium text-white/40 hover:text-white/70">
                  Fechar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
