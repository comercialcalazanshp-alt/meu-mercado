"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Odd = { chance: number; discount: number };

type ScratchCard = {
  id: string;
  customer_phone: string;
  discount_percent: number;
  redeemed: boolean;
  created_at: string;
};

function weekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Raspadinha() {
  const store = useStore();
  const [enabled, setEnabled] = useState(false);
  const [odds, setOdds] = useState<Odd[]>([]);
  const [cards, setCards] = useState<ScratchCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const supabase = getSupabase();
    const [{ data: storeData }, { data: cardData }] = await Promise.all([
      supabase.from("stores").select("scratch_enabled, scratch_odds").eq("id", store.id).single(),
      supabase
        .from("scratch_cards")
        .select("id, customer_phone, discount_percent, redeemed, created_at")
        .eq("store_id", store.id)
        .eq("week_start", weekStart())
        .order("created_at", { ascending: false }),
    ]);
    setEnabled(storeData?.scratch_enabled ?? false);
    setOdds((storeData?.scratch_odds as Odd[]) ?? []);
    setCards((cardData ?? []) as ScratchCard[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const totalChance = odds.reduce((s, o) => s + (Number(o.chance) || 0), 0);

  function updateOdd(i: number, field: "chance" | "discount", value: number) {
    setOdds((prev) => prev.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)));
  }

  function addOdd() {
    setOdds((prev) => [...prev, { chance: 0, discount: 0 }]);
  }

  function removeOdd(i: number) {
    setOdds((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    setError("");
    if (odds.length === 0) {
      setError("Adicione pelo menos uma faixa de chance.");
      return;
    }
    if (totalChance !== 100) {
      setError(`As chances precisam somar 100%. Hoje somam ${totalChance}%.`);
      return;
    }
    setSaving(true);
    const { error: saveError } = await getSupabase()
      .from("stores")
      .update({ scratch_enabled: enabled, scratch_odds: odds })
      .eq("id", store.id);
    setSaving(false);
    if (saveError) {
      setError("Não deu pra salvar: " + saveError.message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Raspadinha</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Brincadeira semanal no site: o cliente digita o WhatsApp e raspa pra tentar ganhar um desconto,
        que é aplicado automaticamente na próxima compra dele com esse número, até o fim da semana. Cada
        WhatsApp só raspa uma vez por semana.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Carregando…</p>
      ) : (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            Raspadinha ativada no site
          </label>

          <p className="mb-1 mt-4 text-xs font-medium text-slate-600 dark:text-slate-400">
            Chances de desconto (precisam somar 100%)
          </p>
          <div className="flex flex-col gap-2">
            {odds.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  value={o.chance}
                  onChange={(e) => updateOdd(i, "chance", Number(e.target.value))}
                  placeholder="% chance"
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <span className="text-sm text-slate-500">% de chance de ganhar</span>
                <input
                  type="number"
                  value={o.discount}
                  onChange={(e) => updateOdd(i, "discount", Number(e.target.value))}
                  placeholder="% desconto"
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <span className="text-sm text-slate-500">% de desconto</span>
                <button
                  onClick={() => removeOdd(i)}
                  className="ml-auto text-sm font-medium text-red-600 dark:text-red-400"
                >
                  remover
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addOdd}
            className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            + faixa
          </button>
          <p className={`mt-2 text-sm ${totalChance === 100 ? "text-slate-500" : "text-red-600 dark:text-red-400"}`}>
            Soma atual: {totalChance}%
          </p>

          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
            >
              {saving ? "Salvando…" : "Salvar configuração"}
            </button>
            {saved && <span className="text-sm text-green-700 dark:text-green-400">Salvo!</span>}
          </div>
        </div>
      )}

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Raspadinhas desta semana
      </h2>
      {!loading && cards.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">Ninguém raspou essa semana ainda.</p>
      )}
      <div className="mt-2 flex flex-col gap-2">
        {cards.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <span className="text-slate-700 dark:text-slate-300">{c.customer_phone}</span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                c.redeemed
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              }`}
            >
              {c.discount_percent}% {c.redeemed ? "(usado)" : "(não usado)"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
