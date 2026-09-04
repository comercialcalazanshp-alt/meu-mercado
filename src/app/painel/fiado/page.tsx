"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Transaction = {
  id: string;
  type: "venda" | "pagamento" | "juros" | "baixa";
  amount: number;
  note: string | null;
  created_at: string;
  due_date: string | null;
};

type Customer = {
  id: string;
  name: string;
  phone: string;
  balance: number;
  credit_limit: number | null;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatDateOnly(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

function isOverdue(dueDate: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate + "T00:00:00") < today;
}

function calcInterest(amount: number, dueDate: string, monthlyRate: number) {
  if (monthlyRate <= 0 || !isOverdue(dueDate)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const daysLate = Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return amount * (monthlyRate / 100) * (daysLate / 30);
}

export default function Fiado() {
  const store = useStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Fica escondido por padrão: se o dono deixa a tela do fiado aberta no
  // balcão, um cliente vindo pagar não pode ver quanto os outros devem.
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [applyingInterestId, setApplyingInterestId] = useState<string | null>(null);

  const [interestPercent, setInterestPercent] = useState("");
  const [savingInterest, setSavingInterest] = useState(false);
  const [interestSaved, setInterestSaved] = useState(false);

  async function loadCustomers() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("credit_customers")
      .select("id, name, phone, balance, credit_limit")
      .eq("store_id", store.id)
      .order("balance", { ascending: false });
    setCustomers(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
    getSupabase()
      .from("stores")
      .select("credit_interest_percent")
      .eq("id", store.id)
      .single()
      .then(({ data }) => {
        if (data) setInterestPercent(data.credit_interest_percent > 0 ? String(data.credit_interest_percent) : "");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleSaveInterest(e: FormEvent) {
    e.preventDefault();
    const value = Number(interestPercent.replace(",", ".")) || 0;
    if (value < 0) return;
    setSavingInterest(true);
    await getSupabase().from("stores").update({ credit_interest_percent: value }).eq("id", store.id);
    setSavingInterest(false);
    setInterestSaved(true);
    setTimeout(() => setInterestSaved(false), 2500);
  }

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
      due_date: dueDate || null,
    });
    setSaving(false);

    if (txError) {
      setError(
        txError.message.includes("limite de crédito")
          ? txError.message
          : "Não deu pra registrar a venda: " + txError.message,
      );
      return;
    }

    setName("");
    setPhone("");
    setAmount("");
    setNote("");
    setDueDate("");
    loadCustomers();
  }

  async function fetchTransactions(customerId: string) {
    const { data } = await getSupabase()
      .from("credit_transactions")
      .select("id, type, amount, note, created_at, due_date")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    setTransactions(data ?? []);
  }

  const interestRate = Number(interestPercent.replace(",", ".")) || 0;

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

  async function handleUpdateCreditLimit(customer: Customer) {
    const raw = window.prompt(
      `Limite de crédito pra ${customer.name} (em R$, deixe vazio pra não ter limite):`,
      customer.credit_limit !== null ? String(customer.credit_limit) : "",
    );
    if (raw === null) return; // cancelou
    const trimmed = raw.trim();
    const value = trimmed ? Number(trimmed.replace(",", ".")) : null;
    if (trimmed && (Number.isNaN(value) || (value as number) < 0)) {
      window.alert("Digite um valor válido (ou deixe vazio pra remover o limite).");
      return;
    }
    setCustomers((prev) => prev.map((c) => (c.id === customer.id ? { ...c, credit_limit: value } : c)));
    await getSupabase().from("credit_customers").update({ credit_limit: value }).eq("id", customer.id);
  }

  async function handleWriteOff(customerId: string, currentBalance: number) {
    if (currentBalance <= 0) return;
    const raw = window.prompt(
      `Dar baixa em quanto da dívida de ${formatCurrency(currentBalance)}? (não é um pagamento recebido — fica registrado como perdão de dívida)`,
      String(currentBalance),
    );
    if (raw === null) return;
    const value = Number(raw.replace(",", "."));
    if (Number.isNaN(value) || value <= 0 || value > currentBalance) {
      window.alert("Digite um valor válido, até o saldo devedor atual.");
      return;
    }
    if (!window.confirm(`Confirma dar baixa em ${formatCurrency(value)}? Essa dívida sai do saldo do cliente sem ter sido paga.`)) return;
    await getSupabase().from("credit_transactions").insert({
      customer_id: customerId,
      type: "baixa",
      amount: value,
      note: "Baixa de dívida incobrável",
    });
    loadCustomers();
    if (expandedId === customerId) fetchTransactions(customerId);
  }

  async function handleApplyInterest(customerId: string, tx: Transaction, interest: number) {
    if (interest <= 0.01 || applyingInterestId) return;
    setApplyingInterestId(tx.id);
    await getSupabase().from("credit_transactions").insert({
      customer_id: customerId,
      type: "juros",
      amount: Math.round(interest * 100) / 100,
      note: `Juros por atraso na venda de ${formatDate(tx.created_at)} (ref:${tx.id})`,
    });
    setApplyingInterestId(null);
    loadCustomers();
    fetchTransactions(customerId);
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
        onSubmit={handleSaveInterest}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Crediário: juros por atraso
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Se você marcar um vencimento na venda, e o cliente atrasar, o juro abaixo é calculado
          por mês de atraso. Ele só vira saldo de verdade quando você clicar em &quot;Aplicar ao
          saldo&quot; no extrato do cliente — até lá é só uma estimativa.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={interestPercent}
            onChange={(e) => setInterestPercent(e.target.value)}
            placeholder="0 = sem juros"
            inputMode="decimal"
            className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          <span className="text-sm text-slate-500 dark:text-slate-400">% ao mês</span>
          <button
            type="submit"
            disabled={savingInterest}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
          >
            {savingInterest ? "Salvando…" : "Salvar"}
          </button>
          {interestSaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
      </form>

      <form
        onSubmit={handleAddSale}
        className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-6"
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
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400">
            Vencimento (opcional)
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
        </div>
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
                  <button
                    type="button"
                    onClick={() => handleUpdateCreditLimit(customer)}
                    className="block text-xs text-slate-400 hover:underline dark:text-slate-500"
                  >
                    {customer.credit_limit !== null
                      ? `Limite: ${formatCurrency(customer.credit_limit)}`
                      : "Sem limite de crédito — definir"}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => toggleReveal(customer.id)}
                      className={`inline-flex items-center gap-1.5 font-semibold ${customer.balance > 0 ? "text-red-600" : "text-green-600"}`}
                      title={revealedIds.has(customer.id) ? "Esconder valor" : "Mostrar valor"}
                    >
                      {revealedIds.has(customer.id) ? (
                        <IconEyeOff className="h-4 w-4 shrink-0 opacity-60" />
                      ) : (
                        <IconEye className="h-4 w-4 shrink-0 opacity-60" />
                      )}
                      {revealedIds.has(customer.id) ? formatCurrency(customer.balance) : "R$ ••••"}
                    </button>
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
                    {transactions.map((tx) => {
                      const overdue = tx.type === "venda" && tx.due_date && isOverdue(tx.due_date);
                      const interestAlreadyApplied = transactions.some(
                        (t) => t.type === "juros" && t.note?.includes(`ref:${tx.id}`),
                      );
                      const interest =
                        tx.type === "venda" && tx.due_date && !interestAlreadyApplied
                          ? calcInterest(tx.amount, tx.due_date, interestRate)
                          : 0;
                      return (
                        <li key={tx.id}>
                          <div className="flex justify-between text-slate-600 dark:text-slate-400">
                            <span>
                              {tx.type === "venda"
                                ? "Venda"
                                : tx.type === "juros"
                                  ? "Juros"
                                  : tx.type === "baixa"
                                    ? "Baixa"
                                    : "Pagamento"}
                              {tx.note ? ` — ${tx.note}` : ""} · {formatDate(tx.created_at)}
                              {tx.due_date && (
                                <>
                                  {" "}
                                  · vence {formatDateOnly(tx.due_date)}
                                  {overdue && (
                                    <span className="ml-1 font-semibold text-red-600">atrasado</span>
                                  )}
                                </>
                              )}
                            </span>
                            <span
                              className={
                                tx.type === "pagamento" || tx.type === "baixa"
                                  ? "text-green-600"
                                  : "text-red-600"
                              }
                            >
                              {tx.type === "pagamento" || tx.type === "baixa" ? "−" : "+"}
                              {formatCurrency(tx.amount)}
                            </span>
                          </div>
                          {interest > 0.01 && (
                            <p className="flex items-center justify-end gap-2 text-right text-xs text-amber-600">
                              <span>+ {formatCurrency(interest)} de juros por atraso (estimativa)</span>
                              <button
                                type="button"
                                onClick={() => handleApplyInterest(customer.id, tx, interest)}
                                disabled={applyingInterestId === tx.id}
                                className="font-semibold underline disabled:opacity-50"
                              >
                                {applyingInterestId === tx.id ? "Aplicando…" : "Aplicar ao saldo"}
                              </button>
                            </p>
                          )}
                        </li>
                      );
                    })}
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
                      <>
                        <button
                          onClick={() => setPayingId(customer.id)}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                        >
                          Registrar pagamento
                        </button>
                        {customer.balance > 0 && (
                          <button
                            onClick={() => handleWriteOff(customer.id, customer.balance)}
                            className="rounded-lg border border-red-200 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                          >
                            Dar baixa
                          </button>
                        )}
                      </>
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

function IconEye({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconEyeOff({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path
        d="M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a17.9 17.9 0 0 1-3.06 3.94M6.3 6.3C3.4 8.1 1 11 1 11s4 7 11 7a10.4 10.4 0 0 0 4.24-.88M1 1l22 22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.12 14.12a3 3 0 1 1-4.24-4.24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
