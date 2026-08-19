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

  async function loadAll() {
    const supabase = getSupabase();
    const { data: rows } = await supabase.from("affiliate_partnerships").select("*").eq("module_store_id", store.id).eq("active", true).limit(1);
    const p = (rows?.[0] as AffiliatePartnership) ?? null;
    setPartnership(p);
    if (!p) {
      setLoading(false);
      return;
    }

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
      const res = await fetch("/api/pagbank/create-subscription-pix", {
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
      const res = await fetch("/api/pagbank/create-package-pix", {
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

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">Carregando…</div>;
  }

  if (!partnership) {
    return (
      <div className="max-w-lg">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Parceria</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Sua loja ainda não está ligada a nenhum Hub como afiliada.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Parceria com {hubName}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {partnership.category} · comissão de {partnership.commission_percent}% pro Hub em cada venda
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Mensalidade</p>
        {partnership.subscription_price ? (
          <>
            <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-50">
              {formatCurrency(partnership.subscription_price)}{" "}
              <span className="text-sm font-normal text-slate-400">/ {BILLING_LABEL[partnership.billing_cycle] ?? partnership.billing_cycle}</span>
            </p>
            {partnership.subscription_due_at && (
              <p className={`mt-0.5 text-sm ${isOverdue ? "font-semibold text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}>
                {isOverdue ? "Venceu em" : "Vence em"} {formatDate(partnership.subscription_due_at)}
                {isOverdue ? " — atrasada" : ""}
              </p>
            )}
            <button
              onClick={pagarMensalidade}
              disabled={generating === "mensalidade"}
              className="mt-3 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-50 dark:bg-blue-800"
            >
              {generating === "mensalidade" ? "Gerando Pix…" : "Pagar mensalidade via Pix"}
            </button>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sem mensalidade configurada.</p>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Cota de imagem por IA</p>
          <span className={`text-sm font-semibold ${quotaFull ? "text-red-600 dark:text-red-400" : "text-slate-500"}`}>
            {aiUsed} de {totalQuota} usadas
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className={`h-full rounded-full ${quotaFull ? "bg-red-600" : "bg-blue-900"}`}
            style={{ width: `${totalQuota > 0 ? Math.min(100, (aiUsed / totalQuota) * 100) : 0}%` }}
          />
        </div>
        {packages.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {packages.map((pkg) => (
              <div key={pkg.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
                <span className="text-sm text-slate-700 dark:text-slate-300">+{pkg.qty} imagens — {formatCurrency(pkg.price)}</span>
                <button
                  onClick={() => comprarPacote(pkg)}
                  disabled={generating === pkg.id}
                  className="rounded-lg border border-blue-900 px-3 py-1 text-xs font-semibold text-blue-900 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300"
                >
                  {generating === pkg.id ? "Gerando…" : "Comprar via Pix"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pix && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !pixPaid && setPix(null)}>
          <div
            className="w-full max-w-xs rounded-2xl bg-white p-5 text-center dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {pixPaid ? (
              <>
                <p className="text-3xl">✅</p>
                <p className="mt-2 font-semibold text-slate-900 dark:text-slate-50">Pago!</p>
              </>
            ) : (
              <>
                <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {pix.kind === "mensalidade" ? "Pague sua mensalidade" : "Pague seu pacote"}
                </p>
                {pix.qrImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pix.qrImage} alt="QR Code Pix" className="mx-auto h-48 w-48" />
                )}
                {pix.qrText && (
                  <button
                    onClick={() => navigator.clipboard.writeText(pix.qrText as string)}
                    className="mt-2 w-full truncate rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
                  >
                    {pix.qrText.slice(0, 40)}… (copiar código)
                  </button>
                )}
                <p className="mt-3 text-xs text-slate-400">Aguardando confirmação…</p>
                <button onClick={() => setPix(null)} className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-700">
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
