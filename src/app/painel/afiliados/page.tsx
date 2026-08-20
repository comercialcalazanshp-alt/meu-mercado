"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import type {
  AffiliatePartnership,
  AffiliateSettings,
  AffiliateExtra,
  AffiliateAiPackage,
  AffiliateAiPurchase,
  PayoutMethod,
  PayoutSpeed,
  PlanType,
  BillingCycle,
} from "@/lib/affiliate-types";

type StoreLite = { id: string; name: string; slug: string };
type View = "list" | "mercado" | "detail" | "precos" | "novo" | "convite" | "convite-pronto";

const PLAN_LABEL: Record<PlanType, string> = { padrao: "Padrão", personalizado: "Personalizado" };
const BILLING_LABEL: Record<BillingCycle, string> = {
  mensal: "Mensal",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};
const BILLING_DAYS: Record<BillingCycle, number> = { mensal: 30, trimestral: 90, semestral: 180, anual: 365 };
const DEFAULT_PRICES: Record<BillingCycle, number> = {
  mensal: 79.9,
  trimestral: 227.7,
  semestral: 431.46,
  anual: 815.0,
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function inputClass() {
  return "rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-1.5 text-sm text-right font-semibold text-white";
}

function fieldRow(label: string, control: ReactNode) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-2.5 last:border-b-0">
      <span className="text-sm text-white/50">{label}</span>
      {control}
    </div>
  );
}

export default function Afiliados() {
  const store = useStore();
  const [view, setView] = useState<View>("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [partnerships, setPartnerships] = useState<AffiliatePartnership[]>([]);
  const [storesById, setStoresById] = useState<Record<string, StoreLite>>({});
  const [settings, setSettings] = useState<AffiliateSettings | null>(null);
  const [extras, setExtras] = useState<AffiliateExtra[]>([]);
  const [packages, setPackages] = useState<AffiliateAiPackage[]>([]);
  const [salesThisMonth, setSalesThisMonth] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [partnershipExtras, setPartnershipExtras] = useState<Record<string, { rowId: string | null; enabled: boolean }>>({});
  const [aiUsed, setAiUsed] = useState(0);
  const [aiPurchases, setAiPurchases] = useState<AffiliateAiPurchase[]>([]);
  const [draft, setDraft] = useState<{
    plan_type: PlanType;
    commission_percent: number;
    payout_method: PayoutMethod;
    payout_speed: PayoutSpeed;
    billing_cycle: BillingCycle;
    subscription_price: number;
    ai_quota_monthly: number | null;
  } | null>(null);
  const [savingDetail, setSavingDetail] = useState(false);

  const [precosDraft, setPrecosDraft] = useState<AffiliateSettings | null>(null);
  const [savingPrecos, setSavingPrecos] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<StoreLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [novoStore, setNovoStore] = useState<StoreLite | null>(null);
  const [novoForm, setNovoForm] = useState({
    category: "",
    owner_name: "",
    tax_id: "",
    address: "",
    license_number: "",
    commission_percent: 12,
    payout_method: "manual" as PayoutMethod,
    payout_speed: "72h" as PayoutSpeed,
    plan_type: "padrao" as PlanType,
    billing_cycle: "mensal" as BillingCycle,
  });
  const [savingNovo, setSavingNovo] = useState(false);
  const [novoError, setNovoError] = useState<string | null>(null);

  const [conviteForm, setConviteForm] = useState({
    suggested_store_name: "",
    whatsapp: "",
    category: "",
    owner_name: "",
    tax_id: "",
    address: "",
    commission_percent: 12,
    payout_method: "manual" as PayoutMethod,
    payout_speed: "72h" as PayoutSpeed,
    plan_type: "padrao" as PlanType,
    billing_cycle: "mensal" as BillingCycle,
  });
  const [savingConvite, setSavingConvite] = useState(false);
  const [conviteError, setConviteError] = useState<string | null>(null);
  const [conviteLink, setConviteLink] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    const supabase = getSupabase();

    const { data: partnershipRows, error: pErr } = await supabase
      .from("affiliate_partnerships")
      .select("*")
      .eq("hub_store_id", store.id)
      .order("created_at", { ascending: false });
    if (pErr) {
      setError(
        "Não deu pra carregar os afiliados — o módulo ainda não foi ativado no banco. " + pErr.message,
      );
      setLoading(false);
      return;
    }
    const list = (partnershipRows ?? []) as AffiliatePartnership[];
    setPartnerships(list);

    if (list.length > 0) {
      const ids = Array.from(new Set(list.map((p) => p.module_store_id)));
      const { data: storeRows } = await supabase.from("stores").select("id, name, slug").in("id", ids);
      const map: Record<string, StoreLite> = {};
      for (const s of (storeRows ?? []) as StoreLite[]) map[s.id] = s;
      setStoresById(map);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const { data: salesRows } = await supabase
        .from("affiliate_settlement_transactions")
        .select("amount")
        .eq("type", "venda")
        .gte("created_at", startOfMonth.toISOString())
        .in(
          "partnership_id",
          list.map((p) => p.id),
        );
      setSalesThisMonth((salesRows ?? []).reduce((sum, r) => sum + Number((r as { amount: number }).amount), 0));
    } else {
      setStoresById({});
      setSalesThisMonth(0);
    }

    const { data: settingsRow } = await supabase
      .from("affiliate_settings")
      .select("*")
      .eq("hub_store_id", store.id)
      .maybeSingle();
    setSettings((settingsRow ?? null) as AffiliateSettings | null);

    const { data: extraRows } = await supabase
      .from("affiliate_extras")
      .select("*")
      .eq("hub_store_id", store.id)
      .order("created_at", { ascending: true });
    setExtras((extraRows ?? []) as AffiliateExtra[]);

    const { data: packageRows } = await supabase
      .from("affiliate_ai_packages")
      .select("*")
      .eq("hub_store_id", store.id)
      .is("partnership_id", null)
      .order("qty", { ascending: true });
    setPackages((packageRows ?? []) as AffiliateAiPackage[]);

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function openDetail(p: AffiliatePartnership) {
    setSelectedId(p.id);
    setDraft({
      plan_type: p.plan_type,
      commission_percent: p.commission_percent,
      payout_method: p.payout_method,
      payout_speed: p.payout_speed ?? "72h",
      billing_cycle: p.billing_cycle,
      subscription_price: p.subscription_price ?? 0,
      ai_quota_monthly: p.ai_quota_monthly,
    });
    setView("detail");

    const supabase = getSupabase();
    const { data: peRows } = await supabase
      .from("affiliate_partnership_extras")
      .select("id, extra_id, enabled")
      .eq("partnership_id", p.id);
    const map: Record<string, { rowId: string | null; enabled: boolean }> = {};
    for (const extra of extras) map[extra.id] = { rowId: null, enabled: false };
    for (const row of (peRows ?? []) as { id: string; extra_id: string; enabled: boolean }[]) {
      map[row.extra_id] = { rowId: row.id, enabled: row.enabled };
    }
    setPartnershipExtras(map);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("affiliate_ai_image_events")
      .select("id", { count: "exact", head: true })
      .eq("partnership_id", p.id)
      .gte("created_at", startOfMonth.toISOString());
    setAiUsed(count ?? 0);

    const { data: purchaseRows } = await supabase
      .from("affiliate_ai_purchases")
      .select("*")
      .eq("partnership_id", p.id)
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: false })
      .limit(5);
    setAiPurchases((purchaseRows ?? []) as AffiliateAiPurchase[]);
  }

  const selected = partnerships.find((p) => p.id === selectedId) ?? null;

  async function saveDetail() {
    if (!selected || !draft) return;
    setSavingDetail(true);
    const { error: updErr } = await getSupabase()
      .from("affiliate_partnerships")
      .update({
        plan_type: draft.plan_type,
        commission_percent: draft.commission_percent,
        payout_method: draft.payout_method,
        payout_speed: draft.payout_method === "manual" ? draft.payout_speed : null,
        billing_cycle: draft.billing_cycle,
        subscription_price: draft.subscription_price,
        ai_quota_monthly: draft.ai_quota_monthly,
      })
      .eq("id", selected.id);
    setSavingDetail(false);
    if (updErr) {
      alert("Não deu pra salvar: " + updErr.message);
      return;
    }
    await loadAll();
  }

  async function toggleActive(p: AffiliatePartnership) {
    if (
      p.active &&
      !confirm(
        `Desativar a parceria com ${storesById[p.module_store_id]?.name ?? "esse afiliado"}? Ele deixa de aparecer no site na hora — mas o histórico e o saldo continuam guardados.`,
      )
    )
      return;
    await getSupabase().from("affiliate_partnerships").update({ active: !p.active }).eq("id", p.id);
    await loadAll();
  }

  async function toggleExtra(extraId: string) {
    if (!selected) return;
    const current = partnershipExtras[extraId] ?? { rowId: null, enabled: false };
    const nextEnabled = !current.enabled;
    setPartnershipExtras((prev) => ({ ...prev, [extraId]: { ...current, enabled: nextEnabled } }));
    const supabase = getSupabase();
    if (current.rowId) {
      await supabase.from("affiliate_partnership_extras").update({ enabled: nextEnabled }).eq("id", current.rowId);
    } else {
      const { data } = await supabase
        .from("affiliate_partnership_extras")
        .insert({ partnership_id: selected.id, extra_id: extraId, enabled: nextEnabled })
        .select("id")
        .single();
      if (data) {
        setPartnershipExtras((prev) => ({ ...prev, [extraId]: { rowId: data.id, enabled: nextEnabled } }));
      }
    }
  }

  function openPrecos() {
    setPrecosDraft(settings ? { ...settings } : null);
    setView("precos");
  }

  async function setupHub() {
    setSavingPrecos(true);
    const supabase = getSupabase();
    const { error: insErr } = await supabase.from("affiliate_settings").insert({ hub_store_id: store.id });
    if (insErr) {
      setSavingPrecos(false);
      alert("Não deu pra configurar: " + insErr.message);
      return;
    }
    await loadAll();
    // Não usa openPrecos() aqui: ela leria "settings" do closure desse
    // render, que ainda está null (setSettings do loadAll só vale a
    // partir do próximo render) — busca a linha nova direto pra não
    // ficar preso na tela de "não configurado" mesmo já tendo criado.
    const { data: freshSettings } = await supabase
      .from("affiliate_settings")
      .select("*")
      .eq("hub_store_id", store.id)
      .maybeSingle();
    setSavingPrecos(false);
    setPrecosDraft((freshSettings ?? null) as AffiliateSettings | null);
    setView("precos");
  }

  async function savePrecos() {
    if (!precosDraft) return;
    setSavingPrecos(true);
    const supabase = getSupabase();
    const { error: updErr } = await supabase
      .from("affiliate_settings")
      .update({
        suggested_commission_percent: precosDraft.suggested_commission_percent,
        price_monthly: precosDraft.price_monthly,
        price_quarterly: precosDraft.price_quarterly,
        price_semiannual: precosDraft.price_semiannual,
        price_annual: precosDraft.price_annual,
        anticipation_fee_48h_percent: precosDraft.anticipation_fee_48h_percent,
        anticipation_fee_72h_percent: precosDraft.anticipation_fee_72h_percent,
        upload_min_resolution_px: precosDraft.upload_min_resolution_px,
        upload_aspect_ratio: precosDraft.upload_aspect_ratio,
        upload_max_size_mb: precosDraft.upload_max_size_mb,
        ai_quota_monthly_default: precosDraft.ai_quota_monthly_default,
      })
      .eq("id", precosDraft.id);
    if (updErr) {
      setSavingPrecos(false);
      alert("Não deu pra salvar: " + updErr.message);
      return;
    }
    await Promise.all(
      extras.map((e) => supabase.from("affiliate_extras").update({ price_monthly: e.price_monthly }).eq("id", e.id)),
    );
    await Promise.all(
      packages.map((pkg) => supabase.from("affiliate_ai_packages").update({ price: pkg.price }).eq("id", pkg.id)),
    );
    setSavingPrecos(false);
    await loadAll();
    setView("list");
  }

  async function runSearch(term: string) {
    setSearchTerm(term);
    if (term.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const partneredIds = new Set(partnerships.filter((p) => p.active).map((p) => p.module_store_id));
    const { data } = await getSupabase()
      .from("stores")
      .select("id, name, slug")
      .eq("active", true)
      .or(`name.ilike.%${term}%,slug.ilike.%${term}%`)
      .limit(8);
    setSearching(false);
    setSearchResults(
      ((data ?? []) as StoreLite[]).filter((s) => s.id !== store.id && !partneredIds.has(s.id)),
    );
  }

  function pickNovoStore(s: StoreLite) {
    setNovoStore(s);
    setSearchResults([]);
    setSearchTerm("");
    setNovoForm((prev) => ({ ...prev, commission_percent: settings?.suggested_commission_percent ?? 12 }));
  }

  async function submitNovo(e: FormEvent) {
    e.preventDefault();
    if (!novoStore) return;
    setNovoError(null);
    if (!novoForm.category.trim() || !novoForm.owner_name.trim() || !novoForm.tax_id.trim() || !novoForm.address.trim()) {
      setNovoError("Preencha categoria, nome do responsável, CPF/CNPJ e endereço.");
      return;
    }
    setSavingNovo(true);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + BILLING_DAYS[novoForm.billing_cycle]);
    const priceTable = {
      mensal: settings?.price_monthly ?? DEFAULT_PRICES.mensal,
      trimestral: settings?.price_quarterly ?? DEFAULT_PRICES.trimestral,
      semestral: settings?.price_semiannual ?? DEFAULT_PRICES.semestral,
      anual: settings?.price_annual ?? DEFAULT_PRICES.anual,
    };
    const { error: insErr } = await getSupabase()
      .from("affiliate_partnerships")
      .insert({
        hub_store_id: store.id,
        module_store_id: novoStore.id,
        category: novoForm.category.trim(),
        owner_name: novoForm.owner_name.trim(),
        tax_id: novoForm.tax_id.trim(),
        address: novoForm.address.trim(),
        license_number: novoForm.license_number.trim() || null,
        commission_percent: novoForm.commission_percent,
        payout_method: novoForm.payout_method,
        payout_speed: novoForm.payout_method === "manual" ? novoForm.payout_speed : null,
        plan_type: novoForm.plan_type,
        billing_cycle: novoForm.billing_cycle,
        subscription_price: novoForm.plan_type === "padrao" ? priceTable[novoForm.billing_cycle] : null,
        subscription_due_at: dueDate.toISOString(),
      });
    setSavingNovo(false);
    if (insErr) {
      setNovoError(
        insErr.code === "23505"
          ? "Já existe um afiliado ativo com essa categoria — categorias são exclusivas por hub."
          : "Não deu pra cadastrar: " + insErr.message,
      );
      return;
    }
    setNovoStore(null);
    setNovoForm({
      category: "",
      owner_name: "",
      tax_id: "",
      address: "",
      license_number: "",
      commission_percent: settings?.suggested_commission_percent ?? 12,
      payout_method: "manual",
      payout_speed: "72h",
      plan_type: "padrao",
      billing_cycle: "mensal",
    });
    await loadAll();
    setView("list");
  }

  async function submitConvite(e: FormEvent) {
    e.preventDefault();
    setConviteError(null);
    if (
      !conviteForm.suggested_store_name.trim() ||
      !conviteForm.whatsapp.trim() ||
      !conviteForm.category.trim() ||
      !conviteForm.owner_name.trim() ||
      !conviteForm.tax_id.trim() ||
      !conviteForm.address.trim()
    ) {
      setConviteError("Preencha nome da loja, WhatsApp, categoria, responsável, CPF/CNPJ e endereço.");
      return;
    }
    setSavingConvite(true);
    const priceTable = {
      mensal: settings?.price_monthly ?? DEFAULT_PRICES.mensal,
      trimestral: settings?.price_quarterly ?? DEFAULT_PRICES.trimestral,
      semestral: settings?.price_semiannual ?? DEFAULT_PRICES.semestral,
      anual: settings?.price_annual ?? DEFAULT_PRICES.anual,
    };
    const { data, error: insErr } = await getSupabase()
      .from("affiliate_invites")
      .insert({
        hub_store_id: store.id,
        suggested_store_name: conviteForm.suggested_store_name.trim(),
        whatsapp: conviteForm.whatsapp.trim(),
        category: conviteForm.category.trim(),
        owner_name: conviteForm.owner_name.trim(),
        tax_id: conviteForm.tax_id.trim(),
        address: conviteForm.address.trim(),
        commission_percent: conviteForm.commission_percent,
        payout_method: conviteForm.payout_method,
        payout_speed: conviteForm.payout_method === "manual" ? conviteForm.payout_speed : null,
        plan_type: conviteForm.plan_type,
        billing_cycle: conviteForm.billing_cycle,
        subscription_price: conviteForm.plan_type === "padrao" ? priceTable[conviteForm.billing_cycle] : null,
      })
      .select("id")
      .single();
    setSavingConvite(false);
    if (insErr || !data) {
      setConviteError("Não deu pra criar o convite: " + insErr?.message);
      return;
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setConviteLink(`${origin}/afiliado/aceitar/${data.id}`);
    setView("convite-pronto");
  }

  function whatsappConviteAfiliadoUrl(link: string) {
    const digits = conviteForm.whatsapp.replace(/\D/g, "");
    const texto = `Oi, ${conviteForm.owner_name}! Você foi convidado(a) pra ser afiliado(a) da nossa plataforma. Abre esse link pra criar sua loja e já começar a vender:\n${link}`;
    return `https://wa.me/55${digits}?text=${encodeURIComponent(texto)}`;
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Afiliados</h1>
        <p className="mt-2 text-sm text-white/40">Carregando…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Afiliados</h1>
        <p className="mt-2 max-w-lg text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  const activeCount = partnerships.filter((p) => p.active).length;
  // "Split automático" ainda não tem integração de verdade com o PagBank —
  // nenhuma rota de pagamento divide dinheiro sozinha, é só um rótulo na
  // tela. Por isso TODO saldo conta aqui, de qualquer método, senão
  // dinheiro real fica escondido achando que já foi pago automaticamente.
  const toRepassar = partnerships.reduce((sum, p) => sum + Math.max(0, Number(p.balance)), 0);

  return (
    <div className="max-w-4xl">
      {view === "list" && (
        <>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-2xl font-bold text-white">Afiliados</h1>
            <div className="flex gap-2">
              <button
                onClick={openPrecos}
                className="rounded-lg border border-white/[0.14] px-3 py-2 text-xs font-semibold text-[#F0BB5E]"
              >
                ⚙ Preços
              </button>
              <button
                onClick={() => setView("convite")}
                className="rounded-lg border border-white/[0.14] px-3 py-2 text-xs font-semibold text-[#F0BB5E]"
              >
                🔗 Convidar por link
              </button>
              <button
                onClick={() => setView("novo")}
                className="rounded-lg bg-blue-900 px-3 py-2 text-xs font-semibold text-amber-300 dark:bg-blue-800"
              >
                + Novo afiliado
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-white/[0.09] bg-white/[0.035] p-3">
              <p className="text-xs text-white/35">Módulos ativos</p>
              <p className="mt-1 text-xl font-bold text-white">{activeCount}</p>
            </div>
            <div className="rounded-xl border border-white/[0.09] bg-white/[0.035] p-3">
              <p className="text-xs text-white/35">Vendido este mês</p>
              <p className="mt-1 text-xl font-bold text-white">
                {formatCurrency(salesThisMonth)}
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.09] bg-white/[0.035] p-3">
              <p className="text-xs text-white/35">A repassar</p>
              <p className="mt-1 text-xl font-bold text-amber-600 dark:text-amber-400">
                {formatCurrency(toRepassar)}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <div
              onClick={() => setView("mercado")}
              className="cursor-pointer rounded-xl border border-amber-300 bg-amber-50 p-4 hover:border-amber-400 dark:border-amber-700 dark:bg-amber-900/10"
            >
              <p className="font-semibold text-white">
                {store.name} <span className="font-normal text-white/40">(você)</span>
              </p>
              <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                Módulo dono · tudo liberado, sem plano
              </p>
            </div>

            {partnerships.length === 0 && (
              <p className="mt-2 text-sm text-white/40">
                Nenhum afiliado cadastrado ainda. Use "+ Novo afiliado" pra ligar a primeira loja parceira.
              </p>
            )}

            {partnerships.map((p) => {
              const s = storesById[p.module_store_id];
              const note =
                p.payout_method === "split_automatico"
                  ? { text: "recebe direto", className: "text-green-600 dark:text-green-400" }
                  : Number(p.balance) > 0
                    ? { text: `a repassar ${formatCurrency(Number(p.balance))}`, className: "text-amber-600 dark:text-amber-400" }
                    : { text: "sem saldo pendente", className: "text-white/30" };
              return (
                <div
                  key={p.id}
                  onClick={() => openDetail(p)}
                  className={`cursor-pointer rounded-xl border p-4 hover:border-white/[0.14] ${
                    p.active ? "border-white/[0.09] bg-white/[0.035]" : "border-white/[0.09] bg-white/[0.02] opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">
                        {s?.name ?? "Loja"} {!p.active && <span className="text-xs font-normal text-white/30">(inativo)</span>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-white/35">
                        {p.category} · Plano {PLAN_LABEL[p.plan_type]} · comissão {p.commission_percent}%
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-white">{formatCurrency(Number(p.balance))}</p>
                      <p className={`text-xs ${note.className}`}>{note.text}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === "mercado" && (
        <>
          <button onClick={() => setView("list")} className="mb-3 text-sm font-medium text-white/40 hover:text-white/70">
            ← Voltar pra Afiliados
          </button>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white">
              {store.name} <span className="font-normal text-white/40">(você)</span>
            </h2>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-400">
              Módulo dono
            </span>
          </div>
          <div className="mt-4 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Comercial</p>
            {fieldRow("Plano", <span className="text-sm text-white/30">Módulo dono — sem plano</span>)}
            {fieldRow("Comissão", <span className="text-sm text-white/30">0% (é a sua loja)</span>)}
            {fieldRow("Recebimento", <span className="text-sm text-white/30">Direto — não passa por repasse</span>)}
          </div>
          <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Gerador de imagem por IA</p>
            <p className="text-sm text-green-600 dark:text-green-400">Cota ilimitada — sem bloqueio, só os afiliados pagam avulso.</p>
          </div>
          <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Extras pagos</p>
            {extras.map((extra) => (
              <div key={extra.id} className="flex items-center justify-between border-b border-white/[0.06] py-2 last:border-b-0">
                <span className="text-sm text-white/60">{extra.name}</span>
                <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
                  Incluso
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {view === "detail" && selected && draft && (
        <>
          <button onClick={() => setView("list")} className="mb-3 text-sm font-medium text-white/40 hover:text-white/70">
            ← Voltar pra Afiliados
          </button>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white">
              {storesById[selected.module_store_id]?.name ?? "Afiliado"}
            </h2>
            <button
              onClick={() => toggleActive(selected)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                selected.active
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                  : "bg-white/[0.08] text-white/55"
              }`}
            >
              {selected.active ? "Ativo" : "Inativo"}
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Comercial</p>
            {fieldRow(
              "Plano",
              <select
                value={draft.plan_type}
                onChange={(e) => setDraft({ ...draft, plan_type: e.target.value as PlanType })}
                className={inputClass()}
              >
                <option value="padrao">Padrão</option>
                <option value="personalizado">Personalizado</option>
              </select>,
            )}
            {fieldRow(
              "Comissão",
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={draft.commission_percent}
                  onChange={(e) => setDraft({ ...draft, commission_percent: Number(e.target.value) })}
                  className={inputClass() + " w-20"}
                />
                <span className="text-sm text-white/40">%</span>
              </div>,
            )}
            {fieldRow(
              "Recebimento",
              <div className="flex rounded-lg bg-white/[0.06] p-0.5">
                <button
                  onClick={() => setDraft({ ...draft, payout_method: "manual" })}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    draft.payout_method === "manual"
                      ? "bg-blue-900 text-amber-300"
                      : "text-white/40"
                  }`}
                >
                  Manual
                </button>
                <button
                  onClick={() => setDraft({ ...draft, payout_method: "split_automatico" })}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    draft.payout_method === "split_automatico"
                      ? "bg-blue-900 text-amber-300"
                      : "text-white/40"
                  }`}
                >
                  Split automático
                </button>
              </div>,
            )}
            {draft.payout_method === "split_automatico" && (
              <p className="pb-2.5 text-xs text-amber-600 dark:text-amber-400">
                ⚠ O split automático ainda não está integrado com o PagBank — hoje o dinheiro cai inteiro na sua conta
                mesmo assim. O saldo continua contando como "a repassar" até essa integração existir de verdade.
              </p>
            )}
            {draft.payout_method === "manual" &&
              fieldRow(
                "Prazo de repasse",
                <div className="flex rounded-lg bg-white/[0.06] p-0.5">
                  {(["48h", "72h", "semanal"] as PayoutSpeed[]).map((speed) => (
                    <button
                      key={speed}
                      onClick={() => setDraft({ ...draft, payout_speed: speed })}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                        draft.payout_speed === speed ? "bg-blue-900 text-amber-300" : "text-white/40"
                      }`}
                    >
                      {speed === "semanal" ? "Semanal" : speed}
                    </button>
                  ))}
                </div>,
              )}
            {fieldRow(
              "Ciclo da assinatura",
              <select
                value={draft.billing_cycle}
                onChange={(e) => setDraft({ ...draft, billing_cycle: e.target.value as BillingCycle })}
                className={inputClass()}
              >
                {(Object.keys(BILLING_LABEL) as BillingCycle[]).map((c) => (
                  <option key={c} value={c}>
                    {BILLING_LABEL[c]}
                  </option>
                ))}
              </select>,
            )}
            {fieldRow(
              `Mensalidade (${BILLING_LABEL[draft.billing_cycle]})`,
              <div className="flex items-center gap-1">
                <span className="text-sm text-white/40">R$</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={draft.subscription_price}
                  onChange={(e) => setDraft({ ...draft, subscription_price: Number(e.target.value) })}
                  className={inputClass() + " w-24"}
                />
              </div>,
            )}
          </div>

          <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Gerador de imagem por IA</p>
            {fieldRow(
              "Cota mensal desse afiliado",
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  placeholder={String(settings?.ai_quota_monthly_default ?? 5)}
                  value={draft.ai_quota_monthly ?? ""}
                  onChange={(e) => setDraft({ ...draft, ai_quota_monthly: e.target.value === "" ? null : Number(e.target.value) })}
                  className={inputClass() + " w-20"}
                />
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, ai_quota_monthly: 999999 })}
                  className="rounded-lg border border-white/[0.14] px-2 py-1 text-xs font-medium text-white/40 hover:text-white/70"
                >
                  Sem limite
                </button>
              </div>,
            )}
            <p className="-mt-1 mb-2 text-xs text-white/30">Em branco usa o padrão do plano ({settings?.ai_quota_monthly_default ?? 5}/mês). Salve pra aplicar.</p>
            {(() => {
              const quota = selected.ai_quota_monthly ?? settings?.ai_quota_monthly_default ?? 5;
              const now = new Date();
              const purchasedThisMonth = aiPurchases
                .filter((pu) => {
                  if (!pu.paid_at) return false;
                  const paid = new Date(pu.paid_at);
                  return paid.getFullYear() === now.getFullYear() && paid.getMonth() === now.getMonth();
                })
                .reduce((sum, pu) => sum + pu.image_qty, 0);
              const total = quota + purchasedThisMonth;
              const full = aiUsed >= total;
              return (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">Cota mensal</span>
                    <span className={`text-sm font-semibold ${full ? "text-red-600 dark:text-red-400" : "text-white/40"}`}>
                      {aiUsed} de {total} usadas
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className={`h-full rounded-full ${full ? "bg-red-600" : "bg-blue-900"}`}
                      style={{ width: `${total > 0 ? Math.min(100, (aiUsed / total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-white/30">Cota base: {quota}/mês (plano) + pacotes comprados no mês</p>
                  {aiPurchases.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1">
                      {aiPurchases.map((pu) => (
                        <p key={pu.id} className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/55">
                          <b className="text-white">{pu.paid_at ? formatDate(pu.paid_at) : "—"}</b> — pacote +
                          {pu.image_qty} imagens · {formatCurrency(pu.price)}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Extras pagos</p>
            {extras.map((extra) => {
              const state = partnershipExtras[extra.id] ?? { rowId: null, enabled: false };
              return (
                <div key={extra.id} className="flex items-center justify-between border-b border-white/[0.06] py-2.5 last:border-b-0">
                  <div>
                    <p className="text-sm font-medium text-white">{extra.name}</p>
                    <p className="text-xs text-white/35">
                      {extra.included_in_padrao ? "Incluso no Plano Padrão" : formatCurrency(extra.price_monthly) + "/mês"}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleExtra(extra.id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      state.enabled
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                        : "bg-white/[0.08] text-white/55"
                    }`}
                  >
                    {state.enabled ? "Ativo" : "Desligado"}
                  </button>
                </div>
              );
            })}
          </div>

          <button
            onClick={saveDetail}
            disabled={savingDetail}
            className="mt-4 w-full rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingDetail ? "Salvando…" : "Salvar alterações"}
          </button>
        </>
      )}

      {view === "precos" && (
        <>
          <button onClick={() => setView("list")} className="mb-3 text-sm font-medium text-white/40 hover:text-white/70">
            ← Voltar pra Afiliados
          </button>
          <h2 className="text-lg font-bold text-white">Preços do Plano Padrão</h2>

          {!settings || !precosDraft ? (
            <div className="mt-4 rounded-xl border border-white/[0.09] bg-white/[0.035] p-6 text-center">
              <p className="text-sm text-white/50">
                O módulo de afiliados ainda não foi configurado nessa loja. Configurar cria os valores padrão (comissão, ciclos
                de assinatura, extras e pacotes de IA) — todos editáveis depois.
              </p>
              <button
                onClick={setupHub}
                disabled={savingPrecos}
                className="mt-4 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
              >
                {savingPrecos ? "Configurando…" : "Configurar agora"}
              </button>
            </div>
          ) : (
            <>
              <p className="mb-3 mt-1 text-xs text-white/35">
                Vale só pra contratos novos — quem já fechou mantém o combinado até você renegociar.
              </p>

              <div className="rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Comissão</p>
                {fieldRow(
                  "Comissão sugerida",
                  <input
                    type="number"
                    className={inputClass() + " w-20"}
                    value={precosDraft.suggested_commission_percent}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, suggested_commission_percent: Number(e.target.value) })}
                  />,
                )}
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Ciclo de assinatura</p>
                {fieldRow(
                  "Mensal",
                  <input
                    type="number"
                    className={inputClass() + " w-24"}
                    value={precosDraft.price_monthly}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, price_monthly: Number(e.target.value) })}
                  />,
                )}
                {fieldRow(
                  "Trimestral",
                  <input
                    type="number"
                    className={inputClass() + " w-24"}
                    value={precosDraft.price_quarterly}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, price_quarterly: Number(e.target.value) })}
                  />,
                )}
                {fieldRow(
                  "Semestral",
                  <input
                    type="number"
                    className={inputClass() + " w-24"}
                    value={precosDraft.price_semiannual}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, price_semiannual: Number(e.target.value) })}
                  />,
                )}
                {fieldRow(
                  "Anual",
                  <input
                    type="number"
                    className={inputClass() + " w-24"}
                    value={precosDraft.price_annual}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, price_annual: Number(e.target.value) })}
                  />,
                )}
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Extras (preço mensal)</p>
                {extras.map((extra) => (
                  <div key={extra.id} className="flex items-center justify-between border-b border-white/[0.06] py-2 last:border-b-0">
                    <span className="text-sm text-white/60">{extra.name}</span>
                    <input
                      type="number"
                      className={inputClass() + " w-24"}
                      value={extra.price_monthly}
                      onChange={(e) =>
                        setExtras((prev) => prev.map((x) => (x.id === extra.id ? { ...x, price_monthly: Number(e.target.value) } : x)))
                      }
                    />
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Gerador de imagem por IA</p>
                {fieldRow(
                  "Cota inclusa no Plano Padrão",
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className={inputClass() + " w-16"}
                      value={precosDraft.ai_quota_monthly_default}
                      onChange={(e) => setPrecosDraft({ ...precosDraft, ai_quota_monthly_default: Number(e.target.value) })}
                    />
                    <span className="text-sm text-white/40">/mês</span>
                  </div>,
                )}
                {packages.map((pkg) => (
                  <div key={pkg.id} className="flex items-center justify-between border-b border-white/[0.06] py-2 last:border-b-0">
                    <span className="text-sm text-white/60">Pacote +{pkg.qty} imagens</span>
                    <input
                      type="number"
                      className={inputClass() + " w-24"}
                      value={pkg.price}
                      onChange={(e) =>
                        setPackages((prev) => prev.map((x) => (x.id === pkg.id ? { ...x, price: Number(e.target.value) } : x)))
                      }
                    />
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Padrão de qualidade (upload próprio)</p>
                {fieldRow(
                  "Resolução mínima (px)",
                  <input
                    type="number"
                    className={inputClass() + " w-24"}
                    value={precosDraft.upload_min_resolution_px}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, upload_min_resolution_px: Number(e.target.value) })}
                  />,
                )}
                {fieldRow(
                  "Proporção exigida",
                  <input
                    type="text"
                    className={inputClass() + " w-24"}
                    value={precosDraft.upload_aspect_ratio}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, upload_aspect_ratio: e.target.value })}
                  />,
                )}
                {fieldRow(
                  "Tamanho máximo (MB)",
                  <input
                    type="number"
                    className={inputClass() + " w-24"}
                    value={precosDraft.upload_max_size_mb}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, upload_max_size_mb: Number(e.target.value) })}
                  />,
                )}
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.09] bg-white/[0.035] p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/30">Taxas de antecipação (repasse manual)</p>
                {fieldRow(
                  "Repasse em 48h",
                  <input
                    type="number"
                    className={inputClass() + " w-20"}
                    value={precosDraft.anticipation_fee_48h_percent}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, anticipation_fee_48h_percent: Number(e.target.value) })}
                  />,
                )}
                {fieldRow(
                  "Repasse em 72h",
                  <input
                    type="number"
                    className={inputClass() + " w-20"}
                    value={precosDraft.anticipation_fee_72h_percent}
                    onChange={(e) => setPrecosDraft({ ...precosDraft, anticipation_fee_72h_percent: Number(e.target.value) })}
                  />,
                )}
                {fieldRow("Semanal", <span className="text-sm text-white/30">Sem taxa</span>)}
              </div>

              <button
                onClick={savePrecos}
                disabled={savingPrecos}
                className="mt-4 w-full rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
              >
                {savingPrecos ? "Salvando…" : "Salvar preços"}
              </button>
            </>
          )}
        </>
      )}

      {view === "novo" && (
        <>
          <button
            onClick={() => {
              setView("list");
              setNovoStore(null);
              setNovoError(null);
            }}
            className="mb-3 text-sm font-medium text-white/40 hover:text-white/70"
          >
            ← Voltar pra Afiliados
          </button>
          <h2 className="text-lg font-bold text-white">Novo afiliado</h2>

          {!novoStore ? (
            <div className="mt-3">
              <p className="mb-2 text-sm text-white/50">
                Busque pela loja que o afiliado já criou no Meu Mercado (nome ou endereço da loja).
              </p>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="Nome ou endereço da loja…"
                className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/25"
              />
              {searching && <p className="mt-2 text-xs text-white/30">Buscando…</p>}
              <div className="mt-2 flex flex-col gap-2">
                {searchResults.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => pickNovoStore(s)}
                    className="rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-left text-sm hover:border-[#F0BB5E]/40"
                  >
                    <span className="font-semibold text-white">{s.name}</span>
                    <span className="ml-2 text-xs text-white/30">/{s.slug}</span>
                  </button>
                ))}
                {searchTerm.trim().length >= 2 && !searching && searchResults.length === 0 && (
                  <p className="text-xs text-white/30">
                    Nenhuma loja ativa encontrada com esse nome — o afiliado precisa criar a própria conta em{" "}
                    <a href="/cadastro" className="underline">
                      /cadastro
                    </a>{" "}
                    primeiro.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={submitNovo} className="mt-3 flex flex-col gap-3">
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm dark:bg-blue-900/20">
                Ligando: <b className="text-white">{novoStore.name}</b>{" "}
                <button type="button" onClick={() => setNovoStore(null)} className="ml-2 text-xs text-blue-700 underline dark:text-blue-400">
                  trocar
                </button>
              </div>

              <label className="text-sm">
                <span className="mb-1 block text-white/45">Categoria (exclusiva no seu hub)</span>
                <input
                  value={novoForm.category}
                  onChange={(e) => setNovoForm({ ...novoForm, category: e.target.value })}
                  placeholder="Ex: Padaria, Açougue, Hortifruti…"
                  className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-white/45">Nome do responsável</span>
                <input
                  value={novoForm.owner_name}
                  onChange={(e) => setNovoForm({ ...novoForm, owner_name: e.target.value })}
                  className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-white/45">CPF ou CNPJ</span>
                <input
                  value={novoForm.tax_id}
                  onChange={(e) => setNovoForm({ ...novoForm, tax_id: e.target.value })}
                  className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-white/45">Endereço do ponto de retirada</span>
                <input
                  value={novoForm.address}
                  onChange={(e) => setNovoForm({ ...novoForm, address: e.target.value })}
                  className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-white/45">Nº de licença/alvará (opcional)</span>
                <input
                  value={novoForm.license_number}
                  onChange={(e) => setNovoForm({ ...novoForm, license_number: e.target.value })}
                  className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
                />
              </label>

              <div className="rounded-xl border border-white/[0.09] bg-white/[0.035] p-3">
                {fieldRow(
                  "Comissão",
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className={inputClass() + " w-20"}
                      value={novoForm.commission_percent}
                      onChange={(e) => setNovoForm({ ...novoForm, commission_percent: Number(e.target.value) })}
                    />
                    <span className="text-sm text-white/40">%</span>
                  </div>,
                )}
                {fieldRow(
                  "Plano",
                  <select
                    value={novoForm.plan_type}
                    onChange={(e) => setNovoForm({ ...novoForm, plan_type: e.target.value as PlanType })}
                    className={inputClass()}
                  >
                    <option value="padrao">Padrão</option>
                    <option value="personalizado">Personalizado</option>
                  </select>,
                )}
                {fieldRow(
                  "Ciclo",
                  <select
                    value={novoForm.billing_cycle}
                    onChange={(e) => setNovoForm({ ...novoForm, billing_cycle: e.target.value as BillingCycle })}
                    className={inputClass()}
                  >
                    {(Object.keys(BILLING_LABEL) as BillingCycle[]).map((c) => (
                      <option key={c} value={c}>
                        {BILLING_LABEL[c]}
                      </option>
                    ))}
                  </select>,
                )}
                {fieldRow(
                  "Recebimento",
                  <select
                    value={novoForm.payout_method}
                    onChange={(e) => setNovoForm({ ...novoForm, payout_method: e.target.value as PayoutMethod })}
                    className={inputClass()}
                  >
                    <option value="manual">Repasse manual</option>
                    <option value="split_automatico">Split automático</option>
                  </select>,
                )}
                {novoForm.payout_method === "manual" &&
                  fieldRow(
                    "Prazo",
                    <select
                      value={novoForm.payout_speed}
                      onChange={(e) => setNovoForm({ ...novoForm, payout_speed: e.target.value as PayoutSpeed })}
                      className={inputClass()}
                    >
                      <option value="48h">48h</option>
                      <option value="72h">72h</option>
                      <option value="semanal">Semanal</option>
                    </select>,
                  )}
              </div>

              {novoError && <p className="text-sm text-red-600 dark:text-red-400">{novoError}</p>}

              <button
                type="submit"
                disabled={savingNovo}
                className="rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
              >
                {savingNovo ? "Cadastrando…" : "Cadastrar afiliado"}
              </button>
            </form>
          )}
        </>
      )}

      {view === "convite" && (
        <>
          <button
            onClick={() => {
              setView("list");
              setConviteError(null);
            }}
            className="mb-3 text-sm font-medium text-white/40 hover:text-white/70"
          >
            ← Voltar pra Afiliados
          </button>
          <h2 className="text-lg font-bold text-white">Convidar por link</h2>
          <p className="mt-1 text-sm text-white/40">
            Defina os termos da parceria agora — a pessoa só confirma e cria a conta dela, sem precisar se cadastrar
            antes.
          </p>

          <form onSubmit={submitConvite} className="mt-3 flex flex-col gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-white/45">Nome da loja dele(a)</span>
              <input
                value={conviteForm.suggested_store_name}
                onChange={(e) => setConviteForm({ ...conviteForm, suggested_store_name: e.target.value })}
                placeholder="Ex: Padaria do João"
                className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-white/45">WhatsApp dele(a)</span>
              <input
                value={conviteForm.whatsapp}
                onChange={(e) => setConviteForm({ ...conviteForm, whatsapp: e.target.value })}
                placeholder="11999998888"
                className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-white/45">Categoria (exclusiva no seu hub)</span>
              <input
                value={conviteForm.category}
                onChange={(e) => setConviteForm({ ...conviteForm, category: e.target.value })}
                placeholder="Ex: Padaria, Açougue, Hortifruti…"
                className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-white/45">Nome do responsável</span>
              <input
                value={conviteForm.owner_name}
                onChange={(e) => setConviteForm({ ...conviteForm, owner_name: e.target.value })}
                className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-white/45">CPF ou CNPJ</span>
              <input
                value={conviteForm.tax_id}
                onChange={(e) => setConviteForm({ ...conviteForm, tax_id: e.target.value })}
                className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-white/45">Endereço do ponto de retirada</span>
              <input
                value={conviteForm.address}
                onChange={(e) => setConviteForm({ ...conviteForm, address: e.target.value })}
                className="w-full rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/25"
              />
            </label>

            <div className="rounded-xl border border-white/[0.09] bg-white/[0.035] p-3">
              {fieldRow(
                "Comissão",
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    className={inputClass() + " w-20"}
                    value={conviteForm.commission_percent}
                    onChange={(e) => setConviteForm({ ...conviteForm, commission_percent: Number(e.target.value) })}
                  />
                  <span className="text-sm text-white/40">%</span>
                </div>,
              )}
              {fieldRow(
                "Plano",
                <select
                  value={conviteForm.plan_type}
                  onChange={(e) => setConviteForm({ ...conviteForm, plan_type: e.target.value as PlanType })}
                  className={inputClass()}
                >
                  <option value="padrao">Padrão</option>
                  <option value="personalizado">Personalizado</option>
                </select>,
              )}
              {fieldRow(
                "Ciclo",
                <select
                  value={conviteForm.billing_cycle}
                  onChange={(e) => setConviteForm({ ...conviteForm, billing_cycle: e.target.value as BillingCycle })}
                  className={inputClass()}
                >
                  {(Object.keys(BILLING_LABEL) as BillingCycle[]).map((c) => (
                    <option key={c} value={c}>
                      {BILLING_LABEL[c]}
                    </option>
                  ))}
                </select>,
              )}
              {fieldRow(
                "Recebimento",
                <select
                  value={conviteForm.payout_method}
                  onChange={(e) => setConviteForm({ ...conviteForm, payout_method: e.target.value as PayoutMethod })}
                  className={inputClass()}
                >
                  <option value="manual">Repasse manual</option>
                  <option value="split_automatico">Split automático</option>
                </select>,
              )}
              {conviteForm.payout_method === "manual" &&
                fieldRow(
                  "Prazo",
                  <select
                    value={conviteForm.payout_speed}
                    onChange={(e) => setConviteForm({ ...conviteForm, payout_speed: e.target.value as PayoutSpeed })}
                    className={inputClass()}
                  >
                    <option value="48h">48h</option>
                    <option value="72h">72h</option>
                    <option value="semanal">Semanal</option>
                  </select>,
                )}
            </div>

            {conviteError && <p className="text-sm text-red-600 dark:text-red-400">{conviteError}</p>}

            <button
              type="submit"
              disabled={savingConvite}
              className="rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
            >
              {savingConvite ? "Gerando link…" : "Gerar link de convite"}
            </button>
          </form>
        </>
      )}

      {view === "convite-pronto" && conviteLink && (
        <>
          <h2 className="text-lg font-bold text-white">Convite pronto!</h2>
          <p className="mt-1 text-sm text-white/50">
            Manda esse link pra {conviteForm.owner_name} — quando ela(e) aceitar, a loja já entra ligada
            automaticamente, sem você precisar fazer mais nada.
          </p>
          <div className="mt-3 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-xs text-white/55">
            {conviteLink}
          </div>
          <div className="mt-3 flex gap-2">
            <a
              href={whatsappConviteAfiliadoUrl(conviteLink)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Mandar pelo WhatsApp
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(conviteLink)}
              className="rounded-lg border border-white/[0.14] px-4 py-2.5 text-sm font-semibold text-white/60"
            >
              Copiar link
            </button>
          </div>
          <button
            onClick={() => {
              setConviteLink(null);
              setConviteForm({
                suggested_store_name: "",
                whatsapp: "",
                category: "",
                owner_name: "",
                tax_id: "",
                address: "",
                commission_percent: settings?.suggested_commission_percent ?? 12,
                payout_method: "manual",
                payout_speed: "72h",
                plan_type: "padrao",
                billing_cycle: "mensal",
              });
              setView("list");
            }}
            className="mt-4 text-sm font-medium text-white/40 hover:text-white/70"
          >
            ← Voltar pra Afiliados
          </button>
        </>
      )}
    </div>
  );
}
