"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { buildReceiptHtml, printHtml } from "@/lib/receipt";
import {
  calcInterest,
  computeCollectionStats,
  defaultDueDate,
  formatCurrency,
  formatDate,
  formatDateOnly,
  isOverdue,
  type CollectionStats,
} from "@/lib/credit";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, useCreditPayment, type PaymentMethod } from "@/lib/use-credit-payment";
import { resetCustomerAccess } from "./actions";
import { Card, Section, PrimaryButton, SecondaryButton, IconSearch, IconChevron, IconEye, IconEyeOff } from "@/components/ui";
import { useThemeColors } from "@/components/ui/theme";

type CashbackCustomer = {
  id: string;
  name: string | null;
  phone: string;
  cashback_balance: number;
  referral_code: string;
};

type CreditCustomer = {
  id: string;
  name: string;
  phone: string;
  balance: number;
  credit_limit: number | null;
};

type MergedCustomer = {
  phone: string;
  name: string;
  cashbackBalance: number;
  referralCode: string | null;
  creditCustomerId: string | null;
  creditBalance: number;
  creditLimit: number | null;
};

type AccountStatus = {
  has_account: boolean;
  locked: boolean;
  email_masked: string | null;
};

type CreditTransaction = {
  id: string;
  type: "venda" | "pagamento" | "juros" | "baixa";
  amount: number;
  note: string | null;
  created_at: string;
  due_date: string | null;
  payment_method: string | null;
};

type OrderItem = { name: string; price: number; quantity: number; line_total?: number };

type OrderRow = {
  id: string;
  items: OrderItem[];
  total: number;
  discount_amount: number;
  status: string;
  created_at: string;
  payment_method: string | null;
  channel: string;
};

const ORDER_PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao: "Cartão",
  fiado: "Fiado",
  combinar: "Combinado com a loja",
  assinatura: "Assinatura",
};

const TX_LABELS: Record<CreditTransaction["type"], string> = {
  venda: "Venda",
  pagamento: "Pagamento",
  juros: "Juros",
  baixa: "Baixa",
};

const INPUT =
  "rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[var(--mm-accent)]/50 focus:outline-none";

async function fetchAllCreditTransactions(customerIds: string[]) {
  const supabase = getSupabase();
  const rows: { customer_id: string; type: string; amount: number; created_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("credit_transactions")
      .select("customer_id, type, amount, created_at")
      .in("customer_id", customerIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (!data) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function ClientesInner() {
  const store = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const COLOR_HEX = useThemeColors();

  const [cashbackCustomers, setCashbackCustomers] = useState<CashbackCustomer[]>([]);
  const [creditCustomers, setCreditCustomers] = useState<CreditCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  const [search, setSearch] = useState("");
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null);
  // Valores de débito ficam escondidos por padrão: com a tela aberta no
  // balcão, um cliente por perto não pode ver quanto os outros devem.
  const [revealedDebts, setRevealedDebts] = useState<Set<string>>(new Set());
  const [totalRevealed, setTotalRevealed] = useState(false);

  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [resettingAccess, setResettingAccess] = useState(false);
  const [resetMessage, setResetMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [applyingInterestId, setApplyingInterestId] = useState<string | null>(null);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [noteDraft, setNoteDraft] = useState("");
  const [blockedDraft, setBlockedDraft] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const [interestPercent, setInterestPercent] = useState("");
  const [creditTermDays, setCreditTermDays] = useState(30);
  const [savingInterest, setSavingInterest] = useState(false);
  const [interestSaved, setInterestSaved] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collectionStats, setCollectionStats] = useState<CollectionStats | null>(null);

  const [saleFormOpen, setSaleFormOpen] = useState(false);
  const [saleName, setSaleName] = useState("");
  const [salePhone, setSalePhone] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [saleNote, setSaleNote] = useState("");
  const [saleDueDate, setSaleDueDate] = useState(() => defaultDueDate(30));
  const [savingSale, setSavingSale] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [saleSaved, setSaleSaved] = useState(false);
  const saleFormRef = useRef<HTMLFormElement>(null);

  const payment = useCreditPayment((customerId) => {
    loadCustomers();
    fetchCreditTransactions(customerId);
  });

  async function loadCustomers() {
    if (!loadedOnce.current) setLoading(true);
    const [{ data: cashback }, { data: credit }] = await Promise.all([
      getSupabase()
        .from("customers")
        .select("id, name, phone, cashback_balance, referral_code")
        .eq("store_id", store.id),
      getSupabase().from("credit_customers").select("id, name, phone, balance, credit_limit").eq("store_id", store.id),
    ]);
    setCashbackCustomers(cashback ?? []);
    setCreditCustomers(credit ?? []);
    loadedOnce.current = true;
    setLoading(false);
  }

  async function fetchCreditTransactions(creditCustomerId: string) {
    const { data } = await getSupabase()
      .from("credit_transactions")
      .select("id, type, amount, note, created_at, due_date, payment_method")
      .eq("customer_id", creditCustomerId)
      .order("created_at", { ascending: false });
    setTransactions((data as CreditTransaction[] | null) ?? []);
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
        setSaleDueDate(defaultDueDate(days));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  // Só calcula quando o dono abre o bloco de capital de giro — puxa o
  // histórico inteiro de fiado, não vale pesar a abertura da tela por isso.
  useEffect(() => {
    if (!settingsOpen || creditCustomers.length === 0) return;
    let cancelled = false;
    fetchAllCreditTransactions(creditCustomers.map((c) => c.id)).then((rows) => {
      if (!cancelled) setCollectionStats(computeCollectionStats(rows, creditTermDays));
    });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, creditCustomers, creditTermDays]);

  const merged = useMemo(() => {
    const map = new Map<string, MergedCustomer>();
    for (const c of cashbackCustomers) {
      map.set(c.phone, {
        phone: c.phone,
        name: c.name || c.phone,
        cashbackBalance: c.cashback_balance,
        referralCode: c.referral_code,
        creditCustomerId: null,
        creditBalance: 0,
        creditLimit: null,
      });
    }
    for (const c of creditCustomers) {
      const existing = map.get(c.phone);
      if (existing) {
        existing.creditCustomerId = c.id;
        existing.creditBalance = c.balance;
        existing.creditLimit = c.credit_limit;
        if (existing.name === existing.phone) existing.name = c.name;
      } else {
        map.set(c.phone, {
          phone: c.phone,
          name: c.name,
          cashbackBalance: 0,
          referralCode: null,
          creditCustomerId: c.id,
          creditBalance: c.balance,
          creditLimit: c.credit_limit,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [cashbackCustomers, creditCustomers]);

  const filtered = useMemo(() => {
    const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const raw = search.trim();
    const q = normalize(raw);
    const looksLikePhone = /^[\d\s()+-]+$/.test(raw);
    const digits = raw.replace(/\D/g, "");
    let list = merged;
    if (onlyDebt) list = list.filter((c) => c.creditBalance > 0);
    if (q) {
      list = list.filter(
        (c) =>
          normalize(c.name).includes(q) ||
          (looksLikePhone && digits.length > 0 && c.phone.replace(/\D/g, "").includes(digits)),
      );
    }
    return onlyDebt ? [...list].sort((a, b) => b.creditBalance - a.creditBalance) : list;
  }, [merged, search, onlyDebt]);

  const totalOwed = creditCustomers.reduce((sum, c) => sum + Math.max(0, c.balance), 0);
  const debtorsCount = creditCustomers.filter((c) => c.balance > 0).length;
  const interestRate = Number(interestPercent.replace(",", ".")) || 0;

  function toggleDebtVisibility(phone: string) {
    setRevealedDebts((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  }

  async function toggleCustomer(customer: MergedCustomer) {
    if (expandedPhone === customer.phone) {
      setExpandedPhone(null);
      return;
    }
    setExpandedPhone(customer.phone);
    setResetMessage(null);
    setAccountStatus(null);
    payment.cancel();

    setLoadingAccount(true);
    getSupabase()
      .rpc("customer_account_status", { p_store_id: store.id, p_phone: customer.phone })
      .then(({ data }) => {
        setAccountStatus(data?.[0] ?? null);
        setLoadingAccount(false);
      });

    setNoteDraft("");
    setBlockedDraft(false);
    setNoteSaved(false);
    getSupabase()
      .from("customer_notes")
      .select("note, blocked")
      .eq("store_id", store.id)
      .eq("phone", customer.phone)
      .maybeSingle()
      .then(({ data }) => {
        setNoteDraft(data?.note ?? "");
        setBlockedDraft(data?.blocked ?? false);
      });

    if (customer.creditCustomerId) {
      fetchCreditTransactions(customer.creditCustomerId);
    } else {
      setTransactions([]);
    }

    setLoadingOrders(true);
    getSupabase()
      .from("orders")
      .select("id, items, total, discount_amount, status, created_at, payment_method, channel")
      .eq("store_id", store.id)
      .eq("customer_phone", customer.phone)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setOrders((data as OrderRow[] | null) ?? []);
        setLoadingOrders(false);
      });
  }

  // Vem de um link tipo "Ver crediário" (ex: tela de Alertas) já apontando
  // pro cliente certo — abre o painel dele sozinho.
  const handledParam = useRef(false);
  useEffect(() => {
    if (handledParam.current || loading) return;
    const clienteId = searchParams.get("cliente");
    if (!clienteId) return;
    handledParam.current = true;
    const match = merged.find((c) => c.creditCustomerId === clienteId);
    if (match) {
      setTimeout(() => {
        toggleCustomer(match);
        setTimeout(() => {
          document.querySelector(`[data-phone="${CSS.escape(match.phone)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 150);
      }, 0);
    }
    router.replace("/painel/clientes");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, merged, searchParams]);

  async function handleResetAccess(customer: MergedCustomer) {
    setResettingAccess(true);
    setResetMessage(null);

    const {
      data: { session },
    } = await getSupabase().auth.getSession();

    if (!session) {
      setResetMessage({ ok: false, text: "Sua sessão expirou. Recarregue a página e tente de novo." });
      setResettingAccess(false);
      return;
    }

    const result = await resetCustomerAccess(session.access_token, store.id, customer.phone, window.location.origin);
    setResettingAccess(false);

    if (result.error) {
      setResetMessage({ ok: false, text: result.error });
      return;
    }

    setResetMessage({
      ok: true,
      text: "Pronto! Mandamos um e-mail de redefinição de senha pro cliente e liberamos o bloqueio.",
    });
    const { data } = await getSupabase().rpc("customer_account_status", {
      p_store_id: store.id,
      p_phone: customer.phone,
    });
    setAccountStatus(data?.[0] ?? null);
  }

  function reprintOrder(order: OrderRow) {
    const html = buildReceiptHtml({
      storeName: store.name,
      whatsapp: store.whatsapp,
      cnpj: store.cnpj,
      paperMm: store.receipt_paper_mm,
      items: order.items.map((item) => ({
        name: item.name,
        qtyLabel: `${item.quantity}x`,
        lineTotal: item.line_total ?? item.price * item.quantity,
      })),
      subtotal: order.total + order.discount_amount,
      discount: order.discount_amount,
      total: order.total,
      paymentLines: [`Pagamento: ${ORDER_PAYMENT_LABELS[order.payment_method ?? ""] ?? "Combinado com a loja"}`],
    });
    printHtml(html);
  }

  function openSaleForm(prefill?: { name: string; phone: string }) {
    setSaleError(null);
    if (prefill) {
      setSaleName(prefill.name);
      setSalePhone(prefill.phone.startsWith("sem-telefone-") ? "" : prefill.phone);
    }
    setSaleFormOpen(true);
    setTimeout(() => saleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
  }

  async function handleAddSale(e: FormEvent) {
    e.preventDefault();
    setSaleError(null);

    const value = Number(saleAmount.replace(",", "."));
    if (!saleName.trim() || !salePhone.trim() || Number.isNaN(value) || value <= 0) {
      setSaleError("Preencha nome, WhatsApp e um valor válido.");
      return;
    }

    setSavingSale(true);
    const supabase = getSupabase();
    const phone = salePhone.trim();

    const { data: customer, error: upsertError } = await supabase
      .from("credit_customers")
      .upsert(
        { store_id: store.id, name: saleName.trim(), phone },
        { onConflict: "store_id,phone", ignoreDuplicates: false },
      )
      .select("id")
      .single();

    if (upsertError || !customer) {
      setSavingSale(false);
      setSaleError("Não deu pra salvar o cliente: " + upsertError?.message);
      return;
    }

    const { error: txError } = await supabase.from("credit_transactions").insert({
      customer_id: customer.id,
      type: "venda",
      amount: value,
      note: saleNote.trim() || null,
      due_date: saleDueDate || null,
    });
    setSavingSale(false);

    if (txError) {
      setSaleError(
        txError.message.includes("limite de crédito")
          ? txError.message
          : "Não deu pra registrar a venda: " + txError.message,
      );
      return;
    }

    setSaleName("");
    setSalePhone("");
    setSaleAmount("");
    setSaleNote("");
    setSaleDueDate(defaultDueDate(creditTermDays));
    setSaleFormOpen(false);
    setSaleSaved(true);
    setTimeout(() => setSaleSaved(false), 2500);
    loadCustomers();
    if (expandedPhone === phone) fetchCreditTransactions(customer.id);
  }

  async function handleUpdateCreditLimit(customer: MergedCustomer) {
    if (!customer.creditCustomerId) return;
    const raw = window.prompt(
      `Limite de crédito pra ${customer.name} (em R$, deixe vazio pra não ter limite):`,
      customer.creditLimit !== null ? String(customer.creditLimit) : "",
    );
    if (raw === null) return;
    const trimmed = raw.trim();
    const value = trimmed ? Number(trimmed.replace(",", ".")) : null;
    if (trimmed && (Number.isNaN(value) || (value as number) < 0)) {
      window.alert("Digite um valor válido (ou deixe vazio pra remover o limite).");
      return;
    }
    setCreditCustomers((prev) => prev.map((c) => (c.id === customer.creditCustomerId ? { ...c, credit_limit: value } : c)));
    await getSupabase().from("credit_customers").update({ credit_limit: value }).eq("id", customer.creditCustomerId);
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
    fetchCreditTransactions(customerId);
  }

  async function handleApplyInterest(customerId: string, tx: CreditTransaction, interest: number) {
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
    fetchCreditTransactions(customerId);
  }

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

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-black">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-36 left-1/4 h-[420px] w-[420px] rounded-full opacity-25 blur-[100px]"
        style={{ background: `radial-gradient(circle, ${COLOR_HEX.accent}30, transparent 65%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 -right-16 h-[360px] w-[360px] rounded-full opacity-20 blur-[100px]"
        style={{ background: `radial-gradient(circle, ${COLOR_HEX.afil}28, transparent 65%)` }}
      />

      <div className="relative mx-auto max-w-3xl px-4 py-6 text-[#F5F3EF] sm:px-6">
        <h1 className="text-xl font-extrabold">Clientes</h1>
        <p className="mt-1 text-[13px] text-white/40">
          Tudo relacionado a um cliente num lugar só: conta/bloqueio, cashback, débito (fiado) com pagamento e
          extrato, e histórico de pedidos.
        </p>

        <Card className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">Total a receber (fiado)</p>
            <button
              type="button"
              onClick={() => setTotalRevealed((v) => !v)}
              aria-label={totalRevealed ? "Esconder total" : "Mostrar total"}
              title={totalRevealed ? "Esconder valor" : "Mostrar valor"}
              className="mt-1 inline-flex items-center gap-2 text-2xl font-extrabold tabular-nums"
              style={{ color: COLOR_HEX.negative }}
            >
              {totalRevealed ? <IconEyeOff className="h-5 w-5 opacity-60" /> : <IconEye className="h-5 w-5 opacity-60" />}
              {totalRevealed ? formatCurrency(totalOwed) : "R$ ••••"}
            </button>
          </div>
          <p className="text-sm text-white/45">
            {debtorsCount} cliente{debtorsCount === 1 ? "" : "s"} com débito
          </p>
        </Card>

        <div className="relative mt-4">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou WhatsApp"
            className="w-full rounded-xl border border-white/[0.09] bg-white/[0.035] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-white/30 backdrop-blur-xl transition focus:border-[var(--mm-accent)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--mm-accent)]/15"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            { label: "Todos", value: false },
            { label: "Só com débito", value: true },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => setOnlyDebt(chip.value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                onlyDebt === chip.value
                  ? "border-transparent text-[#0A0A0C]"
                  : "border-white/[0.12] text-white/55 hover:text-white"
              }`}
              style={onlyDebt === chip.value ? { background: COLOR_HEX.accent } : undefined}
            >
              {chip.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {saleSaved && (
              <span className="animate-mm-fade-in text-xs font-semibold" style={{ color: COLOR_HEX.positive }}>
                Venda fiado registrada!
              </span>
            )}
            <PrimaryButton hex={COLOR_HEX.negative} onClick={() => (saleFormOpen ? setSaleFormOpen(false) : openSaleForm())}>
              {saleFormOpen ? "Fechar" : "+ Lançar venda no fiado"}
            </PrimaryButton>
          </div>
        </div>

        {saleFormOpen && (
          <form
            ref={saleFormRef}
            onSubmit={handleAddSale}
            className="animate-mm-slide-up mt-3 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl"
          >
            <p className="text-sm font-semibold text-white">Lançar venda no fiado</p>
            <p className="mt-0.5 text-xs text-white/40">
              Serve pra cliente novo ou antigo — se o WhatsApp já existe, a venda entra na conta dele.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <input value={saleName} onChange={(e) => setSaleName(e.target.value)} placeholder="Nome do cliente" className={INPUT} />
              <input value={salePhone} onChange={(e) => setSalePhone(e.target.value)} placeholder="WhatsApp" className={INPUT} />
              <input
                value={saleAmount}
                onChange={(e) => setSaleAmount(e.target.value)}
                placeholder="Valor da venda (R$)"
                inputMode="decimal"
                className={INPUT}
              />
              <input value={saleNote} onChange={(e) => setSaleNote(e.target.value)} placeholder="O que levou (opcional)" className={INPUT} />
              <div className="sm:col-span-2">
                <label className="block text-xs text-white/40">Vencimento (opcional)</label>
                <input
                  type="date"
                  value={saleDueDate}
                  onChange={(e) => setSaleDueDate(e.target.value)}
                  className={`${INPUT} mt-1 w-full sm:w-auto`}
                />
              </div>
            </div>
            {saleError && (
              <p className="mt-2 text-sm" style={{ color: COLOR_HEX.negative }}>
                {saleError}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <PrimaryButton type="submit" hex={COLOR_HEX.negative} disabled={savingSale}>
                {savingSale ? "Salvando…" : "Registrar venda fiado"}
              </PrimaryButton>
              <SecondaryButton onClick={() => setSaleFormOpen(false)} disabled={savingSale}>
                Cancelar
              </SecondaryButton>
            </div>
          </form>
        )}

        <div className="mt-3 overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.035] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-white/[0.03]"
          >
            <span className="text-sm font-semibold text-white/80">Crediário: capital de giro, prazo e juros</span>
            <IconChevron className={`h-4 w-4 text-white/30 transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
          </button>
          {settingsOpen && (
            <div className="animate-mm-slide-up space-y-5 border-t border-white/[0.06] p-4">
              {collectionStats && collectionStats.dailyFiadoRate > 0 && (
                <Section dot={COLOR_HEX.warning} label="Capital de giro pro fiado">
                  <p className="text-sm text-white/55">
                    Ritmo atual: {formatCurrency(collectionStats.dailyFiadoRate)}/dia vendido fiado. Prazo combinado
                    com os clientes: {creditTermDays} dias.
                  </p>
                  <p className="mt-2 text-sm text-white/70">
                    Reserva de capital de giro recomendada:{" "}
                    <strong className="font-semibold text-white">{formatCurrency(collectionStats.recommendedReserve)}</strong>{" "}
                    (ritmo × prazo combinado).
                  </p>
                  {collectionStats.avgDays === null ? (
                    <p className="mt-1 text-xs text-white/35">Ainda sem pagamento registrado pra comparar com o prazo combinado.</p>
                  ) : (
                    <p className="mt-1 text-xs text-white/35">
                      Prazo real medido até agora: ~{Math.round(collectionStats.avgDays)} dias ({collectionStats.paymentsCount}{" "}
                      pagamento{collectionStats.paymentsCount === 1 ? "" : "s"}
                      {collectionStats.paymentsCount < 5 ? " — ainda poucos pra confiar" : ""}).
                    </p>
                  )}
                </Section>
              )}
              <Section dot={COLOR_HEX.accent} label="Prazo e juros por atraso">
                <p className="text-xs text-white/40">
                  O prazo preenche sozinho o vencimento de toda venda fiado nova (dá pra mudar em cada venda). Se o
                  cliente passar do vencimento, o juro é calculado por mês de atraso — só vira saldo de verdade quando
                  você clicar em &quot;Aplicar ao saldo&quot; no extrato do cliente.
                </p>
                <form onSubmit={handleSaveInterest} className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={creditTermDays}
                    onChange={(e) => setCreditTermDays(Number(e.target.value) || 0)}
                    inputMode="numeric"
                    className={`${INPUT} w-20`}
                  />
                  <span className="text-sm text-white/45">dias de prazo</span>
                  <input
                    value={interestPercent}
                    onChange={(e) => setInterestPercent(e.target.value)}
                    placeholder="0 = sem juros"
                    inputMode="decimal"
                    className={`${INPUT} w-32`}
                  />
                  <span className="text-sm text-white/45">% ao mês de juros</span>
                  <PrimaryButton type="submit" hex={COLOR_HEX.accent} disabled={savingInterest}>
                    {savingInterest ? "Salvando…" : "Salvar"}
                  </PrimaryButton>
                  {interestSaved && (
                    <span className="animate-mm-fade-in text-xs font-semibold" style={{ color: COLOR_HEX.positive }}>
                      Salvo!
                    </span>
                  )}
                </form>
              </Section>
            </div>
          )}
        </div>

        {loading && (
          <div className="mt-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="mt-6 text-sm text-white/35">
            {onlyDebt && !search.trim() ? "Nenhum cliente com débito." : "Nenhum cliente encontrado."}
          </p>
        )}

        <div className="mt-4 space-y-3">
          {filtered.map((customer, i) => {
            const expanded = expandedPhone === customer.phone;
            const revealed = revealedDebts.has(customer.phone);
            const hasRealPhone = !customer.phone.startsWith("sem-telefone-") && /\d{8,}/.test(customer.phone.replace(/\D/g, ""));
            return (
              <div
                key={customer.phone}
                data-phone={customer.phone}
                className="animate-mm-fade-up overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.035] backdrop-blur-xl"
                style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onClick={() => toggleCustomer(customer)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      toggleCustomer(customer);
                    }
                  }}
                  className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 p-4 text-left transition hover:bg-white/[0.03]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{customer.name}</p>
                    <p className="text-[13px] text-white/40">{customer.phone}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {customer.cashbackBalance > 0 && (
                      <span
                        className="animate-mm-badge-bump rounded-full px-2.5 py-1 text-xs font-bold"
                        style={{ background: `${COLOR_HEX.positive}22`, color: COLOR_HEX.positive }}
                      >
                        {formatCurrency(customer.cashbackBalance)}
                      </span>
                    )}
                    {customer.creditBalance > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDebtVisibility(customer.phone);
                        }}
                        aria-label={revealed ? "Esconder valor do débito" : "Mostrar valor do débito"}
                        title={revealed ? "Esconder valor" : "Mostrar valor"}
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition hover:brightness-125"
                        style={{ background: `${COLOR_HEX.negative}22`, color: COLOR_HEX.negative }}
                      >
                        {revealed ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
                        <span>{revealed ? `${formatCurrency(customer.creditBalance)} débito` : "débito"}</span>
                      </button>
                    )}
                    <IconChevron className={`h-4 w-4 text-white/30 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </div>
                </div>

                {expanded && (
                  <div className="animate-mm-slide-up space-y-5 border-t border-white/[0.06] p-4">
                    <Section dot="#8B8FA3" label="Nota interna">
                      <div className="flex items-center justify-between gap-2">
                        {hasRealPhone ? (
                          <a
                            href={`https://wa.me/55${customer.phone.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold underline underline-offset-2"
                            style={{ color: COLOR_HEX.positive }}
                          >
                            Abrir WhatsApp
                          </a>
                        ) : (
                          <span />
                        )}
                        <label className="flex items-center gap-1.5 text-xs font-medium" style={{ color: COLOR_HEX.negative }}>
                          <input
                            type="checkbox"
                            checked={blockedDraft}
                            onChange={(e) => setBlockedDraft(e.target.checked)}
                            className="h-3.5 w-3.5 accent-[#FF5C68]"
                          />
                          Bloquear cliente
                        </label>
                      </div>
                      <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="Só você vê essa nota — ex: atrasa pagamento, pede pra não tocar buzina..."
                        rows={2}
                        className={`${INPUT} mt-1.5 w-full placeholder:text-white/25`}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <PrimaryButton
                          hex={COLOR_HEX.accent}
                          disabled={savingNote}
                          onClick={async () => {
                            setSavingNote(true);
                            await getSupabase()
                              .from("customer_notes")
                              .upsert({ store_id: store.id, phone: customer.phone, note: noteDraft.trim() || null, blocked: blockedDraft, updated_at: new Date().toISOString() });
                            setSavingNote(false);
                            setNoteSaved(true);
                            setTimeout(() => setNoteSaved(false), 2000);
                          }}
                        >
                          {savingNote ? "Salvando…" : "Salvar"}
                        </PrimaryButton>
                        {noteSaved && (
                          <span className="animate-mm-fade-in text-xs font-semibold" style={{ color: COLOR_HEX.positive }}>
                            Salvo!
                          </span>
                        )}
                        {blockedDraft && (
                          <span className="text-xs" style={{ color: COLOR_HEX.negative }}>
                            Cliente bloqueado — não consegue mais fazer pedidos.
                          </span>
                        )}
                      </div>
                    </Section>

                    <Section dot={COLOR_HEX.negative} label="Débito (fiado)">
                      {customer.creditCustomerId ? (
                        <>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="font-semibold" style={{ color: customer.creditBalance > 0 ? COLOR_HEX.negative : COLOR_HEX.positive }}>
                              {formatCurrency(customer.creditBalance)} em aberto
                            </p>
                            <button
                              type="button"
                              onClick={() => handleUpdateCreditLimit(customer)}
                              className="text-xs text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
                            >
                              {customer.creditLimit !== null
                                ? `Limite: ${formatCurrency(customer.creditLimit)}`
                                : "Sem limite de crédito — definir"}
                            </button>
                          </div>

                          {transactions.length > 0 && (
                            <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
                              {transactions.map((tx) => {
                                const overdue = tx.type === "venda" && tx.due_date && isOverdue(tx.due_date);
                                const interestAlreadyApplied = transactions.some(
                                  (t) => t.type === "juros" && t.note?.includes(`ref:${tx.id}`),
                                );
                                const interest =
                                  tx.type === "venda" && tx.due_date && !interestAlreadyApplied
                                    ? calcInterest(tx.amount, tx.due_date, interestRate)
                                    : 0;
                                const reducesDebt = tx.type === "pagamento" || tx.type === "baixa";
                                return (
                                  <li key={tx.id}>
                                    <div className="flex justify-between gap-3 text-white/50">
                                      <span className="min-w-0">
                                        {TX_LABELS[tx.type]}
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
                                              <span className="ml-1 font-semibold" style={{ color: COLOR_HEX.negative }}>
                                                atrasado
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </span>
                                      <span
                                        className="shrink-0 font-medium tabular-nums"
                                        style={{ color: reducesDebt ? COLOR_HEX.positive : COLOR_HEX.negative }}
                                      >
                                        {reducesDebt ? "−" : "+"}
                                        {formatCurrency(tx.amount)}
                                      </span>
                                    </div>
                                    {interest > 0.01 && (
                                      <p className="mt-0.5 flex items-center justify-end gap-2 text-right text-xs" style={{ color: COLOR_HEX.warning }}>
                                        <span>+ {formatCurrency(interest)} de juros por atraso (estimativa)</span>
                                        <button
                                          type="button"
                                          onClick={() => handleApplyInterest(customer.creditCustomerId!, tx, interest)}
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
                          )}

                          <div className="mt-3">
                            {payment.payingId === customer.creditCustomerId ? (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  payment.confirm({
                                    id: customer.creditCustomerId!,
                                    name: customer.name,
                                    balance: customer.creditBalance,
                                  });
                                }}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <input
                                  value={payment.amount}
                                  onChange={(e) => payment.setAmount(e.target.value)}
                                  placeholder="Valor pago (R$)"
                                  inputMode="decimal"
                                  autoFocus
                                  className={`${INPUT} w-36`}
                                />
                                <div className="flex overflow-hidden rounded-lg border border-white/[0.12]">
                                  {PAYMENT_METHODS.map((method) => (
                                    <button
                                      key={method}
                                      type="button"
                                      onClick={() => payment.setMethod(method)}
                                      className={`px-3 py-1.5 text-sm font-medium transition ${
                                        payment.method === method ? "text-[#0A0A0C]" : "text-white/60 hover:text-white"
                                      }`}
                                      style={payment.method === method ? { background: COLOR_HEX.positive } : undefined}
                                    >
                                      {PAYMENT_METHOD_LABELS[method]}
                                    </button>
                                  ))}
                                </div>
                                <PrimaryButton type="submit" hex={COLOR_HEX.positive} disabled={payment.confirming}>
                                  {payment.confirming ? "Salvando…" : "Confirmar"}
                                </PrimaryButton>
                                <SecondaryButton onClick={payment.cancel} disabled={payment.confirming}>
                                  Cancelar
                                </SecondaryButton>
                              </form>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <PrimaryButton hex={COLOR_HEX.positive} onClick={() => payment.start(customer.creditCustomerId!)}>
                                  Registrar pagamento
                                </PrimaryButton>
                                <SecondaryButton onClick={() => openSaleForm({ name: customer.name, phone: customer.phone })}>
                                  Lançar venda fiado
                                </SecondaryButton>
                                {customer.creditBalance > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleWriteOff(customer.creditCustomerId!, customer.creditBalance)}
                                    title="Pra receber um pagamento de verdade, use 'Registrar pagamento' — esse aqui é só pra perdoar dívida que não vai ser cobrada"
                                    className="rounded-lg border px-3.5 py-1.5 text-sm font-medium transition hover:brightness-125"
                                    style={{ borderColor: `${COLOR_HEX.negative}55`, color: COLOR_HEX.negative }}
                                  >
                                    Perdoar dívida
                                  </button>
                                )}
                              </div>
                            )}
                            {payment.error && payment.payingId === customer.creditCustomerId && (
                              <p className="mt-2 text-sm" style={{ color: COLOR_HEX.negative }}>
                                {payment.error}
                              </p>
                            )}
                          </div>

                          {payment.success && payment.success.customerId === customer.creditCustomerId && (
                            <div
                              className="mt-3 rounded-lg border p-3 text-sm"
                              style={{ borderColor: `${COLOR_HEX.positive}40`, background: `${COLOR_HEX.positive}12` }}
                            >
                              <p className="font-medium" style={{ color: COLOR_HEX.positive }}>
                                Pagamento de {formatCurrency(payment.success.amount)} registrado ({payment.success.methodLabel}).
                              </p>
                              <button
                                type="button"
                                onClick={payment.printReceipt}
                                className="mt-1 text-sm font-medium underline underline-offset-2"
                                style={{ color: COLOR_HEX.positive }}
                              >
                                Imprimir comprovante
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm text-white/40">Esse cliente não tem fiado registrado.</p>
                          <SecondaryButton onClick={() => openSaleForm({ name: customer.name, phone: customer.phone })}>
                            Lançar venda fiado
                          </SecondaryButton>
                        </div>
                      )}
                    </Section>

                    <Section dot={COLOR_HEX.accent} label="Conta">
                      {loadingAccount && <p className="text-sm text-white/35">Checando…</p>}
                      {!loadingAccount && accountStatus && !accountStatus.has_account && (
                        <p className="text-sm text-white/40">Esse cliente ainda não criou uma conta — comprou como visitante.</p>
                      )}
                      {!loadingAccount && accountStatus?.has_account && (
                        <div className="space-y-2">
                          <p className="text-sm text-white/55">
                            Conta ativa ({accountStatus.email_masked}){" "}
                            {accountStatus.locked && (
                              <span className="font-semibold" style={{ color: COLOR_HEX.negative }}>
                                — bloqueada
                              </span>
                            )}
                          </p>
                          <SecondaryButton onClick={() => handleResetAccess(customer)} disabled={resettingAccess}>
                            {resettingAccess ? "Enviando…" : "Resetar acesso / senha"}
                          </SecondaryButton>
                          {resetMessage && (
                            <p className="text-sm" style={{ color: resetMessage.ok ? COLOR_HEX.positive : COLOR_HEX.negative }}>
                              {resetMessage.text}
                            </p>
                          )}
                        </div>
                      )}
                    </Section>

                    {customer.cashbackBalance > 0 && (
                      <Section dot={COLOR_HEX.positive} label="Cashback">
                        <p className="text-sm font-semibold" style={{ color: COLOR_HEX.positive }}>
                          Saldo: {formatCurrency(customer.cashbackBalance)}
                          {customer.referralCode && (
                            <span className="font-normal text-white/40"> · Código de indicação: {customer.referralCode}</span>
                          )}
                        </p>
                      </Section>
                    )}

                    <Section dot={COLOR_HEX.afil} label="Histórico de pedidos">
                      {loadingOrders && <p className="text-sm text-white/35">Carregando…</p>}
                      {!loadingOrders && orders.length === 0 && (
                        <p className="text-sm text-white/35">Nenhum pedido registrado.</p>
                      )}
                      <ul className="space-y-2">
                        {orders.map((order) => (
                          <li
                            key={order.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-sm"
                          >
                            <span className="text-white/55">
                              {formatDate(order.created_at)} · <span className="font-medium text-white/80">{formatCurrency(order.total)}</span>
                            </span>
                            <SecondaryButton small onClick={() => reprintOrder(order)}>
                              Reimprimir cupom
                            </SecondaryButton>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Clientes() {
  return (
    <Suspense fallback={null}>
      <ClientesInner />
    </Suspense>
  );
}
