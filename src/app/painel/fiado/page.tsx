"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { buildCreditPaymentReceiptHtml, printHtml } from "@/lib/receipt";

type PaymentMethod = "dinheiro" | "pix" | "cartao";

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao: "Cartão",
};

type Transaction = {
  id: string;
  type: "venda" | "pagamento" | "juros" | "baixa";
  amount: number;
  note: string | null;
  created_at: string;
  due_date: string | null;
  payment_method: string | null;
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

function defaultDueDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
  const [search, setSearch] = useState("");
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
  const [dueDate, setDueDate] = useState(() => defaultDueDate(30));
  const [saving, setSaving] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("dinheiro");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState<{
    customerId: string;
    customerName: string;
    amount: number;
    methodLabel: string;
    balanceBefore: number;
    balanceAfter: number;
  } | null>(null);
  const [applyingInterestId, setApplyingInterestId] = useState<string | null>(null);

  const [interestPercent, setInterestPercent] = useState("");
  const [creditTermDays, setCreditTermDays] = useState(30);
  const [savingInterest, setSavingInterest] = useState(false);
  const [interestSaved, setInterestSaved] = useState(false);

  const [collectionStats, setCollectionStats] = useState<{
    avgDays: number | null;
    paymentsCount: number;
    dailyFiadoRate: number;
    recommendedReserve: number;
  } | null>(null);

  async function loadCustomers() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("credit_customers")
      .select("id, name, phone, balance, credit_limit")
      .eq("store_id", store.id)
      .order("balance", { ascending: false });
    setCustomers(data ?? []);
    setLoading(false);
    loadCollectionStats(data ?? []);
  }

  // Prazo médio de recebimento do fiado — não vem de estimativa, é medido de
  // verdade: casa cada pagamento com a(s) venda(s) fiado mais antiga(s)
  // daquele cliente que ainda estavam em aberto (FIFO, tipo fila), calcula
  // quantos dias se passaram entre a venda e o pagamento, e faz a média
  // ponderada pelo valor. Com isso dá pra recomendar quanto guardar de
  // reserva pra girar o fiado sem aperto: ritmo diário de venda fiado ×
  // prazo médio de recebimento.
  async function loadCollectionStats(customerList: Customer[]) {
    if (customerList.length === 0) {
      setCollectionStats(null);
      return;
    }
    const { data } = await getSupabase()
      .from("credit_transactions")
      .select("customer_id, type, amount, created_at")
      .in(
        "customer_id",
        customerList.map((c) => c.id),
      )
      .order("created_at", { ascending: true });
    const txs = data ?? [];

    const byCustomer = new Map<string, typeof txs>();
    for (const t of txs) {
      if (!byCustomer.has(t.customer_id)) byCustomer.set(t.customer_id, []);
      byCustomer.get(t.customer_id)!.push(t);
    }

    let weightedDaysSum = 0;
    let collectedAmountSum = 0;
    let paymentsCount = 0;

    for (const custTxs of byCustomer.values()) {
      const queue: { date: string; remaining: number }[] = [];
      for (const t of custTxs) {
        if (t.type === "venda" || t.type === "juros") {
          queue.push({ date: t.created_at, remaining: Number(t.amount) });
        } else if (t.type === "pagamento" || t.type === "baixa") {
          let toConsume = Number(t.amount);
          if (t.type === "pagamento") paymentsCount += 1;
          while (toConsume > 0.001 && queue.length > 0) {
            const oldest = queue[0];
            const consumed = Math.min(oldest.remaining, toConsume);
            if (t.type === "pagamento") {
              const days = (new Date(t.created_at).getTime() - new Date(oldest.date).getTime()) / (1000 * 60 * 60 * 24);
              weightedDaysSum += days * consumed;
              collectedAmountSum += consumed;
            }
            oldest.remaining -= consumed;
            toConsume -= consumed;
            if (oldest.remaining <= 0.001) queue.shift();
          }
        }
      }
    }

    const avgDays = collectedAmountSum > 0 ? weightedDaysSum / collectedAmountSum : null;

    // ritmo diário de fiado: soma das vendas fiado nos últimos até 30 dias
    // (ou desde a primeira venda, se a loja tiver menos tempo de uso que isso).
    const vendaTxs = txs.filter((t) => t.type === "venda");
    let dailyFiadoRate = 0;
    if (vendaTxs.length > 0) {
      const firstDate = new Date(vendaTxs[0].created_at).getTime();
      const daysSpan = Math.max(1, (Date.now() - firstDate) / (1000 * 60 * 60 * 24));
      const window = Math.min(daysSpan, 30);
      const cutoff = Date.now() - window * 24 * 60 * 60 * 1000;
      const recentTotal = vendaTxs.filter((t) => new Date(t.created_at).getTime() >= cutoff).reduce((s, t) => s + Number(t.amount), 0);
      dailyFiadoRate = recentTotal / window;
    }

    // A reserva usa o prazo COMBINADO com os clientes (ex: 30 dias) como
    // base, não a média medida — com pouquíssimo pagamento registrado ainda,
    // a média real fica instável demais (um cliente que pagou rápido em 4
    // dias não quer dizer que todo mundo paga em 4 dias). A média medida
    // aparece à parte, como comparação, e só deve pesar mais quando tiver
    // pagamento suficiente acumulado.
    const recommendedReserve = dailyFiadoRate * creditTermDays;

    setCollectionStats({ avgDays, paymentsCount, dailyFiadoRate, recommendedReserve });
  }

  useEffect(() => {
    loadCustomers();
    getSupabase()
      .from("stores")
      .select("credit_interest_percent, credit_term_days")
      .eq("id", store.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setInterestPercent(data.credit_interest_percent > 0 ? String(data.credit_interest_percent) : "");
        const days = data.credit_term_days ?? 30;
        setCreditTermDays(days);
        setDueDate(defaultDueDate(days));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleSaveInterest(e: FormEvent) {
    e.preventDefault();
    const value = Number(interestPercent.replace(",", ".")) || 0;
    if (value < 0) return;
    if (!Number.isInteger(creditTermDays) || creditTermDays < 1) return;
    setSavingInterest(true);
    await getSupabase()
      .from("stores")
      .update({ credit_interest_percent: value, credit_term_days: creditTermDays })
      .eq("id", store.id);
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
    setDueDate(defaultDueDate(creditTermDays));
    loadCustomers();
  }

  async function fetchTransactions(customerId: string) {
    const { data } = await getSupabase()
      .from("credit_transactions")
      .select("id, type, amount, note, created_at, due_date, payment_method")
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

  async function handlePayment(customer: Customer) {
    if (confirmingPayment) return;
    const value = Number(paymentAmount.replace(",", "."));
    if (Number.isNaN(value) || value <= 0) return;

    setConfirmingPayment(true);
    const { error: txError } = await getSupabase().from("credit_transactions").insert({
      customer_id: customer.id,
      type: "pagamento",
      amount: value,
      payment_method: paymentMethod,
    });
    setConfirmingPayment(false);
    if (txError) return;

    setPaymentSuccess({
      customerId: customer.id,
      customerName: customer.name,
      amount: value,
      methodLabel: PAYMENT_METHOD_LABELS[paymentMethod],
      balanceBefore: customer.balance,
      balanceAfter: customer.balance - value,
    });
    setPaymentAmount("");
    setPayingId(null);
    loadCustomers();
    if (expandedId === customer.id) fetchTransactions(customer.id);
  }

  function printPaymentReceipt() {
    if (!paymentSuccess) return;
    printHtml(
      buildCreditPaymentReceiptHtml({
        storeName: store.name,
        whatsapp: store.whatsapp,
        cnpj: store.cnpj,
        paperMm: store.receipt_paper_mm || 55,
        customerName: paymentSuccess.customerName,
        amount: paymentSuccess.amount,
        paymentMethodLabel: paymentSuccess.methodLabel,
        balanceBefore: paymentSuccess.balanceBefore,
        balanceAfter: paymentSuccess.balanceAfter,
      }),
    );
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
    if (
      !window.confirm(
        "Atenção: isso é pra PERDOAR uma dívida que você não vai cobrar (cliente sumiu, deu calote etc). Se o cliente pagou de verdade, cancele aqui e use o botão \"Registrar pagamento\" em vez desse.\n\nContinuar mesmo assim?",
      )
    )
      return;
    const raw = window.prompt(
      `Perdoar quanto da dívida de ${formatCurrency(currentBalance)}? (fica registrado como perdão, não como pagamento recebido)`,
      String(currentBalance),
    );
    if (raw === null) return;
    const value = Number(raw.replace(",", "."));
    if (Number.isNaN(value) || value <= 0 || value > currentBalance) {
      window.alert("Digite um valor válido, até o saldo devedor atual.");
      return;
    }
    if (!window.confirm(`Confirma perdoar ${formatCurrency(value)}? Essa dívida sai do saldo do cliente sem ter sido paga.`)) return;
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

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    // "".includes("") é sempre true — sem o length>0, buscar só por letras
    // (sem dígito nenhum) fazia a condição de telefone bater com todo mundo
    // e a busca não filtrava nada.
    const qDigits = q.replace(/\D/g, "");
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || (qDigits.length > 0 && c.phone.replace(/\D/g, "").includes(qDigits)),
    );
  }, [customers, search]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Crediário</h1>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          {formatCurrency(totalOwed)}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">total a receber</p>
      </div>

      {collectionStats && collectionStats.dailyFiadoRate > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Capital de giro pro fiado
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Ritmo atual: {formatCurrency(collectionStats.dailyFiadoRate)}/dia vendido fiado. Prazo combinado com os
            clientes: {creditTermDays} dias.
          </p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            Reserva de capital de giro recomendada:{" "}
            <strong className="font-semibold">{formatCurrency(collectionStats.recommendedReserve)}</strong> (ritmo ×
            prazo combinado).
          </p>
          {collectionStats.avgDays === null ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Ainda sem pagamento registrado pra comparar com o prazo combinado.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Prazo real medido até agora: ~{Math.round(collectionStats.avgDays)} dias (
              {collectionStats.paymentsCount} pagamento{collectionStats.paymentsCount === 1 ? "" : "s"}
              {collectionStats.paymentsCount < 5 ? " — ainda poucos pra confiar" : ""}).
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={handleSaveInterest}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Crediário: prazo e juros por atraso
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          O prazo abaixo preenche sozinho o vencimento de toda venda fiado nova (dá pra mudar em cada venda, se
          precisar). Se o cliente passar do vencimento, o juro é calculado por mês de atraso — só vira saldo de
          verdade quando você clicar em &quot;Aplicar ao saldo&quot; no extrato do cliente.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={creditTermDays}
            onChange={(e) => setCreditTermDays(Number(e.target.value) || 0)}
            inputMode="numeric"
            className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          <span className="text-sm text-slate-500 dark:text-slate-400">dias de prazo</span>
          <input
            value={interestPercent}
            onChange={(e) => setInterestPercent(e.target.value)}
            placeholder="0 = sem juros"
            inputMode="decimal"
            className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          <span className="text-sm text-slate-500 dark:text-slate-400">% ao mês de juros</span>
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

      <div className="mt-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente por nome ou telefone…"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
      </div>

      <div className="mt-3 space-y-3">
        {loading && <p className="text-sm text-slate-500">Carregando…</p>}
        {!loading && customers.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum cliente fiado registrado ainda.</p>
        )}
        {!loading && customers.length > 0 && filteredCustomers.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum cliente encontrado pra essa busca.</p>
        )}
        {filteredCustomers.map((customer) => {
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
                              {tx.note ? ` — ${tx.note}` : ""}
                              {tx.type === "pagamento" && tx.payment_method
                                ? ` (${PAYMENT_METHOD_LABELS[tx.payment_method as PaymentMethod] ?? tx.payment_method})`
                                : ""}{" "}
                              · {formatDate(tx.created_at)}
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

                  <div className="mt-3 flex flex-wrap items-center gap-2">
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
                        <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
                          {(["dinheiro", "pix", "cartao"] as PaymentMethod[]).map((method) => (
                            <button
                              key={method}
                              type="button"
                              onClick={() => setPaymentMethod(method)}
                              className={`px-2.5 py-1 text-sm font-medium ${
                                paymentMethod === method
                                  ? "bg-blue-900 text-amber-300 dark:bg-blue-800"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              {PAYMENT_METHOD_LABELS[method]}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => handlePayment(customer)}
                          disabled={confirmingPayment}
                          className="rounded-lg bg-green-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {confirmingPayment ? "Salvando…" : "Confirmar"}
                        </button>
                        <button
                          onClick={() => setPayingId(null)}
                          disabled={confirmingPayment}
                          className="text-sm text-slate-500 hover:underline disabled:opacity-60 dark:text-slate-400"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setPaymentSuccess(null);
                            setPaymentMethod("dinheiro");
                            setPayingId(customer.id);
                          }}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                        >
                          Registrar pagamento
                        </button>
                        {customer.balance > 0 && (
                          <button
                            onClick={() => handleWriteOff(customer.id, customer.balance)}
                            className="rounded-lg border border-red-200 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                            title="Pra receber um pagamento de verdade, use o botão 'Registrar pagamento' — esse aqui é só pra perdoar dívida que não vai ser cobrada"
                          >
                            Perdoar dívida
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {paymentSuccess && paymentSuccess.customerId === customer.id && (
                    <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950">
                      <p className="font-medium text-green-700 dark:text-green-400">
                        Pagamento de {formatCurrency(paymentSuccess.amount)} registrado ({paymentSuccess.methodLabel}).
                      </p>
                      <button
                        type="button"
                        onClick={printPaymentReceipt}
                        className="mt-1 text-sm font-medium text-green-700 underline underline-offset-2 dark:text-green-400"
                      >
                        Imprimir comprovante
                      </button>
                    </div>
                  )}
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
