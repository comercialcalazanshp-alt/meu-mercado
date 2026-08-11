"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Kit = {
  id: string;
  name: string;
  price: number;
  active: boolean;
};

type Subscription = {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  kit_id: string | null;
  monthly_amount: number;
  active: boolean;
  last_generated_at: string | null;
  created_at: string;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function currentMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function Assinaturas() {
  const store = useStore();
  const [kits, setKits] = useState<Kit[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [kitId, setKitId] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatedMsg, setGeneratedMsg] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const supabase = getSupabase();
    const [{ data: kitData }, { data: subData }] = await Promise.all([
      supabase.from("kits").select("id, name, price, active").eq("store_id", store.id).eq("active", true).order("name"),
      supabase
        .from("subscriptions")
        .select("id, customer_name, customer_phone, kit_id, monthly_amount, active, last_generated_at, created_at")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
    ]);
    setKits((kitData ?? []) as Kit[]);
    setSubscriptions((subData ?? []) as Subscription[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  function openNewForm() {
    setEditingId(null);
    setCustomerName("");
    setCustomerPhone("");
    setKitId("");
    setMonthlyAmount("");
    setError("");
    setFormOpen(true);
  }

  function openEditForm(s: Subscription) {
    setEditingId(s.id);
    setCustomerName(s.customer_name ?? "");
    setCustomerPhone(s.customer_phone);
    setKitId(s.kit_id ?? "");
    setMonthlyAmount(String(s.monthly_amount));
    setError("");
    setFormOpen(true);
  }

  function handleKitChange(id: string) {
    setKitId(id);
    const kit = kits.find((k) => k.id === id);
    if (kit) setMonthlyAmount(String(kit.price));
  }

  async function handleSave() {
    setError("");
    const phone = normalizePhone(customerPhone);
    if (phone.length < 10) {
      setError("Digite um WhatsApp válido.");
      return;
    }
    if (!kitId) {
      setError("Selecione um kit já cadastrado em Kits.");
      return;
    }
    const amount = Number(monthlyAmount.replace(",", "."));
    if (!amount || amount <= 0) {
      setError("Informe o valor mensal.");
      return;
    }

    setSaving(true);
    const supabase = getSupabase();
    const payload = {
      store_id: store.id,
      customer_name: customerName.trim() || null,
      customer_phone: phone,
      kit_id: kitId,
      monthly_amount: amount,
    };
    const { error: saveError } = editingId
      ? await supabase.from("subscriptions").update(payload).eq("id", editingId)
      : await supabase.from("subscriptions").insert({ ...payload, active: true });
    setSaving(false);

    if (saveError) {
      setError("Não deu pra salvar: " + saveError.message);
      return;
    }
    setFormOpen(false);
    load();
  }

  async function toggleActive(s: Subscription) {
    await getSupabase().from("subscriptions").update({ active: !s.active }).eq("id", s.id);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir essa assinatura? Não dá pra desfazer.")) return;
    await getSupabase().from("subscriptions").delete().eq("id", id);
    load();
  }

  async function handleGenerate(id: string) {
    setGeneratingId(id);
    const { error: genError } = await getSupabase().rpc("generate_subscription_order", {
      p_subscription_id: id,
    });
    setGeneratingId(null);
    if (genError) {
      setGeneratedMsg((prev) => ({ ...prev, [id]: "Erro: " + genError.message }));
      return;
    }
    setGeneratedMsg((prev) => ({ ...prev, [id]: "Pedido gerado! Já está em Pedidos, como pendente." }));
    load();
  }

  const monthStart = currentMonthStart();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Assinaturas</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Cliente fixo escolhe um kit por um valor mensal — todo mês você gera o pedido dele com 1
            clique, sem remontar do zero.
          </p>
        </div>
        <button
          onClick={openNewForm}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 dark:bg-blue-800"
        >
          + Nova assinatura
        </button>
      </div>

      {kits.length === 0 && !loading && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Você ainda não tem nenhum kit ativo.{" "}
          <a href="/painel/kits" className="underline">
            Cadastre um kit primeiro
          </a>{" "}
          — a assinatura sempre gira em torno de um kit.
        </p>
      )}

      {formOpen && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                WhatsApp do cliente
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="71 9XXXX-XXXX"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Nome do cliente
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nome"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Kit / cesta
            </label>
            <select
              value={kitId}
              onChange={(e) => handleKitChange(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">Selecione um kit já cadastrado em Kits</option>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({formatCurrency(k.price)})
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Valor mensal (R$)
            </label>
            <input
              type="number"
              step="0.01"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
            <button
              onClick={() => setFormOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading && <p className="mt-6 text-sm text-slate-500">Carregando…</p>}

      {!loading && subscriptions.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">Nenhuma assinatura cadastrada ainda.</p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {subscriptions.map((s) => {
          const kit = kits.find((k) => k.id === s.kit_id);
          const generatedThisMonth = !!s.last_generated_at && s.last_generated_at.slice(0, 10) >= monthStart;
          return (
            <div
              key={s.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">
                    {s.customer_name || s.customer_phone}
                    {!s.active && (
                      <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        pausada
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {s.customer_phone} · {kit ? kit.name : "(kit removido)"} ·{" "}
                    {formatCurrency(s.monthly_amount)}/mês
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    generatedThisMonth
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  }`}
                >
                  {generatedThisMonth ? "gerado esse mês" : "devendo gerar"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {!generatedThisMonth && s.active && (
                  <button
                    onClick={() => handleGenerate(s.id)}
                    disabled={generatingId === s.id}
                    className="rounded-lg bg-blue-900 px-3 py-1.5 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
                  >
                    {generatingId === s.id ? "Gerando…" : "🧺 Gerar pedido desse mês"}
                  </button>
                )}
                <button
                  onClick={() => openEditForm(s)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Editar
                </button>
                <button
                  onClick={() => toggleActive(s)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  {s.active ? "Pausar" : "Reativar"}
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 dark:border-red-900 dark:text-red-400"
                >
                  Excluir
                </button>
              </div>
              {generatedMsg[s.id] && (
                <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{generatedMsg[s.id]}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
