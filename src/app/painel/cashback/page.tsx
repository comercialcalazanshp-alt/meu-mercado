"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Customer = {
  id: string;
  name: string | null;
  phone: string;
  cashback_balance: number;
  referral_code: string;
  referred_by: string | null;
  birthday: string | null;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Tier = "Bronze" | "Prata" | "Ouro";

const TIER_STYLES: Record<Tier, string> = {
  Bronze: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
  Prata: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  Ouro: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
};

function tierFor(spent: number, silverThreshold: number, goldThreshold: number): Tier {
  if (goldThreshold > 0 && spent >= goldThreshold) return "Ouro";
  if (silverThreshold > 0 && spent >= silverThreshold) return "Prata";
  return "Bronze";
}

function endOfMonthIso() {
  const d = new Date();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
  return end.toISOString();
}

export default function Cashback() {
  const store = useStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [cashbackPercent, setCashbackPercent] = useState("");
  const [referralBonus, setReferralBonus] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [generatedCoupon, setGeneratedCoupon] = useState<Record<string, string>>({});

  const [silverThreshold, setSilverThreshold] = useState("");
  const [goldThreshold, setGoldThreshold] = useState("");
  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const [loyaltySaved, setLoyaltySaved] = useState(false);
  const [spentByCustomer, setSpentByCustomer] = useState<Record<string, number>>({});

  async function loadCustomers() {
    setLoading(true);
    const [{ data }, { data: orderRows }] = await Promise.all([
      getSupabase()
        .from("customers")
        .select("id, name, phone, cashback_balance, referral_code, referred_by, birthday")
        .eq("store_id", store.id)
        .order("cashback_balance", { ascending: false }),
      getSupabase()
        .from("orders")
        .select("customer_id, total, status")
        .eq("store_id", store.id)
        .not("customer_id", "is", null),
    ]);
    setCustomers(data ?? []);

    const spent: Record<string, number> = {};
    for (const order of orderRows ?? []) {
      if (order.status === "cancelado" || !order.customer_id) continue;
      spent[order.customer_id] = (spent[order.customer_id] ?? 0) + order.total;
    }
    setSpentByCustomer(spent);
    setLoading(false);
  }

  useEffect(() => {
    async function loadSettings() {
      const { data } = await getSupabase()
        .from("stores")
        .select("cashback_percent, referral_bonus, loyalty_silver_threshold, loyalty_gold_threshold")
        .eq("id", store.id)
        .single();
      if (data) {
        setCashbackPercent(data.cashback_percent > 0 ? String(data.cashback_percent) : "");
        setReferralBonus(data.referral_bonus > 0 ? String(data.referral_bonus) : "");
        setSilverThreshold(
          data.loyalty_silver_threshold > 0 ? String(data.loyalty_silver_threshold) : "",
        );
        setGoldThreshold(data.loyalty_gold_threshold > 0 ? String(data.loyalty_gold_threshold) : "");
      }
    }
    loadSettings();
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleSaveLoyalty(e: FormEvent) {
    e.preventDefault();
    const silver = Number(silverThreshold.replace(",", ".")) || 0;
    const gold = Number(goldThreshold.replace(",", ".")) || 0;
    if (silver < 0 || gold < 0) return;

    setSavingLoyalty(true);
    await getSupabase()
      .from("stores")
      .update({ loyalty_silver_threshold: silver, loyalty_gold_threshold: gold })
      .eq("id", store.id);
    setSavingLoyalty(false);
    setLoyaltySaved(true);
    setTimeout(() => setLoyaltySaved(false), 2500);
  }

  const loyaltyEnabled =
    (Number(silverThreshold.replace(",", ".")) || 0) > 0 ||
    (Number(goldThreshold.replace(",", ".")) || 0) > 0;

  const customersByTier = useMemo(() => {
    const silver = Number(silverThreshold.replace(",", ".")) || 0;
    const gold = Number(goldThreshold.replace(",", ".")) || 0;
    return customers
      .map((c) => ({ customer: c, spent: spentByCustomer[c.id] ?? 0 }))
      .filter((c) => c.spent > 0)
      .sort((a, b) => b.spent - a.spent)
      .map((c) => ({ ...c, tier: tierFor(c.spent, silver, gold) }));
  }, [customers, spentByCustomer, silverThreshold, goldThreshold]);

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    const percent = Number(cashbackPercent.replace(",", ".")) || 0;
    const bonus = Number(referralBonus.replace(",", ".")) || 0;
    if (percent < 0 || percent > 100 || bonus < 0) return;

    setSavingSettings(true);
    await getSupabase()
      .from("stores")
      .update({ cashback_percent: percent, referral_bonus: bonus })
      .eq("id", store.id);
    setSavingSettings(false);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2500);
  }

  const withBalance = useMemo(() => customers.filter((c) => c.cashback_balance > 0), [customers]);

  const birthdaysThisMonth = useMemo(() => {
    const month = new Date().getMonth();
    return customers.filter((c) => c.birthday && new Date(c.birthday + "T00:00:00").getMonth() === month);
  }, [customers]);

  async function handleGenerateBirthdayCoupon(customer: Customer) {
    setGeneratingFor(customer.id);
    const code = `ANIV${Math.floor(1000 + Math.random() * 9000)}`;
    const { error } = await getSupabase().from("coupons").insert({
      store_id: store.id,
      code,
      discount_type: "percent",
      discount_value: 10,
      usage_limit: 1,
      expires_at: endOfMonthIso(),
    });
    setGeneratingFor(null);
    if (!error) {
      setGeneratedCoupon((prev) => ({ ...prev, [customer.id]: code }));
    }
  }

  function whatsappBirthdayUrl(customer: Customer, code: string) {
    const message = encodeURIComponent(
      `Feliz aniversário! 🎉 Um presentinho da ${store.name} pra você: use o cupom ${code} e ganhe 10% de desconto na sua próxima compra esse mês.`,
    );
    return `https://wa.me/55${customer.phone.replace(/\D/g, "")}?text=${message}`;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Cashback, indicação e fidelidade
      </h1>

      <form
        onSubmit={handleSaveSettings}
        className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Configurações
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Cashback por compra (%)</label>
            <input
              value={cashbackPercent}
              onChange={(e) => setCashbackPercent(e.target.value)}
              placeholder="0 = desativado"
              inputMode="decimal"
              className="mt-1 w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">
              Bônus por indicação (R$)
            </label>
            <input
              value={referralBonus}
              onChange={(e) => setReferralBonus(e.target.value)}
              placeholder="0 = desativado"
              inputMode="decimal"
              className="mt-1 w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <button
            type="submit"
            disabled={savingSettings}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingSettings ? "Salvando…" : "Salvar"}
          </button>
          {settingsSaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Cashback ganho vira saldo que o cliente pode usar no próximo pedido do site. Bônus de indicação é
          creditado uma vez, tanto pra quem indicou quanto pra quem foi indicado, no primeiro pedido com o
          código.
        </p>
      </form>

      <form
        onSubmit={handleSaveLoyalty}
        className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Níveis de fidelidade
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Todo cliente começa Bronze. A partir de quanto ele gastou (no total, na sua loja) ele sobe
          de nível.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">
              Vira Prata a partir de (R$)
            </label>
            <input
              value={silverThreshold}
              onChange={(e) => setSilverThreshold(e.target.value)}
              placeholder="0 = desativado"
              inputMode="decimal"
              className="mt-1 w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">
              Vira Ouro a partir de (R$)
            </label>
            <input
              value={goldThreshold}
              onChange={(e) => setGoldThreshold(e.target.value)}
              placeholder="0 = desativado"
              inputMode="decimal"
              className="mt-1 w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <button
            type="submit"
            disabled={savingLoyalty}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingLoyalty ? "Salvando…" : "Salvar"}
          </button>
          {loyaltySaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
      </form>

      {loyaltyEnabled && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Clientes por nível
          </h2>
          {customersByTier.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">Nenhum cliente com compras ainda.</p>
          )}
          <ul className="mt-2 space-y-2">
            {customersByTier.map(({ customer, spent, tier }) => (
              <li key={customer.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300">
                  {customer.name || customer.phone}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400">{formatCurrency(spent)}</span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${TIER_STYLES[tier]}`}
                  >
                    {tier}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {birthdaysThisMonth.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Aniversariantes do mês
          </h2>
          <ul className="mt-3 space-y-2">
            {birthdaysThisMonth.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-700 dark:text-slate-300">{c.name || c.phone}</span>
                {generatedCoupon[c.id] ? (
                  <a
                    href={whatsappBirthdayUrl(c, generatedCoupon[c.id])}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white"
                  >
                    Cupom {generatedCoupon[c.id]} · Enviar no WhatsApp
                  </a>
                ) : (
                  <button
                    onClick={() => handleGenerateBirthdayCoupon(c)}
                    disabled={generatingFor === c.id}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
                  >
                    {generatingFor === c.id ? "Gerando…" : "Gerar cupom de aniversário"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Clientes com saldo de cashback
        </h2>
        {loading && <p className="mt-2 text-sm text-slate-500">Carregando…</p>}
        {!loading && withBalance.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">Nenhum cliente com saldo ainda.</p>
        )}
        <ul className="mt-2 space-y-2">
          {withBalance.map((c) => (
            <li key={c.id} className="flex items-center justify-between text-sm">
              <span className="text-slate-700 dark:text-slate-300">
                {c.name || c.phone} · {c.phone}
              </span>
              <span className="font-semibold text-green-700 dark:text-green-400">
                {formatCurrency(c.cashback_balance)}
              </span>
            </li>
          ))}
        </ul>
        <a
          href="/painel/clientes"
          className="mt-3 inline-block text-sm font-medium text-blue-900 underline dark:text-blue-400"
        >
          Ver todos os clientes, conta e histórico →
        </a>
      </div>
    </div>
  );
}
