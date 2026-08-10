"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Transaction = {
  id: string;
  type: "venda" | "pagamento";
  amount: number;
  note: string | null;
  created_at: string;
};

type Customer = {
  id: string;
  name: string;
  phone: string;
  balance: number;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function Fiado() {
  const store = useStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);

  async function loadCustomers() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("credit_customers")
      .select("id, name, phone, balance")
      .eq("store_id", store.id)
      .order("balance", { ascending: false });
    setCustomers(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const totalOwed = customers.reduce((sum, c) => sum + Math.max(0, c.balance), 0);

  async function handleAddSale(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const value = Number(amount.replace(",", "."));
    if (!name.trim() || !phone.trim() || Number.isNaN(value) || value <= 0) {
      setError("Preencha nome, WhatsApp e um valor válido.");
      return;
    }

    setSaving(true);
    const supabase = getSupabase();

    const { data: customer, error: upsertError } = await supabase
      .from("credit_customers")
      .upsert(
        { store_id: store.id, name: name.trim(), phone: phone.trim() },
        { onConflict: "store_id,phone", ignoreDuplicates: false },
      )
      .select("id")
      .single();

    if (upsertError || !customer) {
      setSaving(false);
      setError("Não deu pra salvar o cliente: " + upsertError?.message);
      return;
    }

    const { error: txError } = await supabase.from("credit_transactions").insert({
      customer_id: customer.id,
      type: "venda",
      amount: value,
      note: note.trim() || null,
    });
    setSaving(false);

    if (txError) {
      setError("Não deu pra registrar a venda: " + txError.message);
      return;
    }

    setName("");
    setPhone("");
    setAmount("");
    setNote("");
    loadCustomers();
  }

  async function fetchTransactions(customerId: string) {
    const { data } = await getSupabase()
      .from("credit_transactions")
      .select("id, type, amount, note, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    setTransactions(data ?? []);
  }

  async function toggleTransactions(customerId: string) {
    if (expandedId === customerId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(customerId);
    await fetchTransactions(customerId);
  }

  async function handlePayment(customerId: string) {
    const value = Number(paymentAmount.replace(",", "."));
    if (Number.isNaN(value) || value <= 0) return;

    await getSupabase().from("credit_transactions").insert({
      customer_id: customerId,
      type: "pagamento",
      amount: value,
    });

    setPaymentAmount("");
    setPayingId(null);
    loadCustomers();
    if (expandedId === customerId) fetchTransactions(customerId);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Fiado / crediário</h1>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          {formatCurrency(totalOwed)}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">total a receber</p>
      </div>

      <form
        onSubmit={handleAddSale}
        className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do cliente"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="WhatsApp"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Valor da venda (R$)"
          inputMode="decimal"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="O que levou (opcional)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {saving ? "Salvando…" : "Registrar venda fiado"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-6 space-y-3">
        {loading && <p className="text-sm text-slate-500">Carregando…</p>}
        {!loading && customers.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum cliente fiado registrado ainda.</p>
        )}
        {customers.map((customer) => {
          const concentration = totalOwed > 0 ? (Math.max(0, customer.balance) / totalOwed) * 100 : 0;
          return (
            <div
              key={customer.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">{customer.name}</p>
                  <a
                    href={`https://wa.me/55${customer.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-900 underline dark:text-blue-400"
                  >
                    {customer.phone}
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p
                      className={`font-semibold ${customer.balance > 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {formatCurrency(customer.balance)}
                    </p>
                    {concentration >= 30 && customer.balance > 0 && (
                      <p className="text-xs text-amber-600">
                        {concentration.toFixed(0)}% do fiado total
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => toggleTransactions(customer.id)}
                    className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
                  >
                    {expandedId === customer.id ? "Fechar" : "Ver extrato"}
                  </button>
                </div>
              </div>

              {expandedId === customer.id && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <ul className="space-y-1 text-sm">
                    {transactions.map((tx) => (
                      <li key={tx.id} className="flex justify-between text-slate-600 dark:text-slate-400">
                        <span>
                          {tx.type === "venda" ? "Venda" : "Pagamento"}
                          {tx.note ? ` — ${tx.note}` : ""} · {formatDate(tx.created_at)}
                        </span>
                        <span className={tx.type === "venda" ? "text-red-600" : "text-green-600"}>
                          {tx.type === "venda" ? "+" : "−"}
                          {formatCurrency(tx.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 flex items-center gap-2">
                    {payingId === customer.id ? (
                      <>
                        <input
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          placeholder="Valor pago (R$)"
                          inputMode="decimal"
                          autoFocus
                          className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                        />
                        <button
                          onClick={() => handlePayment(customer.id)}
                          className="rounded-lg bg-green-600 px-3 py-1 text-sm font-medium text-white"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => setPayingId(null)}
                          className="text-sm text-slate-500 hover:underline dark:text-slate-400"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setPayingId(customer.id)}
                        className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                      >
                        Registrar pagamento
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
