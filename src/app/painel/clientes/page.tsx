"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { buildReceiptHtml, printHtml } from "@/lib/receipt";
import { resetCustomerAccess } from "./actions";

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
};

type MergedCustomer = {
  phone: string;
  name: string;
  cashbackBalance: number;
  referralCode: string | null;
  creditCustomerId: string | null;
  creditBalance: number;
};

type AccountStatus = {
  has_account: boolean;
  locked: boolean;
  email_masked: string | null;
};

type CreditTransaction = {
  id: string;
  type: "venda" | "pagamento";
  amount: number;
  note: string | null;
  created_at: string;
  due_date: string | null;
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

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao: "Cartão",
  fiado: "Fiado",
  combinar: "Combinado com a loja",
  assinatura: "Assinatura",
};

export default function Clientes() {
  const store = useStore();
  const [cashbackCustomers, setCashbackCustomers] = useState<CashbackCustomer[]>([]);
  const [creditCustomers, setCreditCustomers] = useState<CreditCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null);

  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [resettingAccess, setResettingAccess] = useState(false);
  const [resetMessage, setResetMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [payingOpen, setPayingOpen] = useState(false);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [noteDraft, setNoteDraft] = useState("");
  const [blockedDraft, setBlockedDraft] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  async function loadCustomers() {
    setLoading(true);
    const [{ data: cashback }, { data: credit }] = await Promise.all([
      getSupabase()
        .from("customers")
        .select("id, name, phone, cashback_balance, referral_code")
        .eq("store_id", store.id),
      getSupabase().from("credit_customers").select("id, name, phone, balance").eq("store_id", store.id),
    ]);
    setCashbackCustomers(cashback ?? []);
    setCreditCustomers(credit ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

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
      });
    }
    for (const c of creditCustomers) {
      const existing = map.get(c.phone);
      if (existing) {
        existing.creditCustomerId = c.id;
        existing.creditBalance = c.balance;
        if (existing.name === existing.phone) existing.name = c.name;
      } else {
        map.set(c.phone, {
          phone: c.phone,
          name: c.name,
          cashbackBalance: 0,
          referralCode: null,
          creditCustomerId: c.id,
          creditBalance: c.balance,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [cashbackCustomers, creditCustomers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "")),
    );
  }, [merged, search]);

  async function toggleCustomer(customer: MergedCustomer) {
    if (expandedPhone === customer.phone) {
      setExpandedPhone(null);
      return;
    }
    setExpandedPhone(customer.phone);
    setResetMessage(null);
    setPayingOpen(false);
    setAccountStatus(null);

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
      getSupabase()
        .from("credit_transactions")
        .select("id, type, amount, note, created_at, due_date")
        .eq("customer_id", customer.creditCustomerId)
        .order("created_at", { ascending: false })
        .then(({ data }) => setTransactions(data ?? []));
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

  async function handleRegisterPayment(customer: MergedCustomer) {
    if (savingPayment) return;
    const value = Number(paymentAmount.replace(",", "."));
    if (Number.isNaN(value) || value <= 0 || !customer.creditCustomerId) return;

    setSavingPayment(true);
    await getSupabase().from("credit_transactions").insert({
      customer_id: customer.creditCustomerId,
      type: "pagamento",
      amount: value,
    });

    setPaymentAmount("");
    setPayingOpen(false);
    await loadCustomers();
    const { data } = await getSupabase()
      .from("credit_transactions")
      .select("id, type, amount, note, created_at, due_date")
      .eq("customer_id", customer.creditCustomerId)
      .order("created_at", { ascending: false });
    setTransactions(data ?? []);
    setSavingPayment(false);
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
      paymentLines: [`Pagamento: ${PAYMENT_LABELS[order.payment_method ?? ""] ?? "Combinado com a loja"}`],
    });
    printHtml(html);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Clientes</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Tudo relacionado a um cliente num lugar só: conta/bloqueio, saldo de cashback, fiado em aberto e
        histórico de pedidos (com reimpressão de cupom).
      </p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome ou WhatsApp"
        className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
      />

      {loading && <p className="text-sm text-slate-500">Carregando…</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-sm text-slate-500">Nenhum cliente encontrado.</p>
      )}

      <div className="space-y-3">
        {filtered.map((customer) => (
          <div
            key={customer.phone}
            className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            <button
              onClick={() => toggleCustomer(customer)}
              className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left"
            >
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{customer.name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{customer.phone}</p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                {customer.cashbackBalance > 0 && (
                  <span className="text-green-700 dark:text-green-400">
                    {formatCurrency(customer.cashbackBalance)} cashback
                  </span>
                )}
                {customer.creditBalance > 0 && (
                  <span className="text-red-600">{formatCurrency(customer.creditBalance)} fiado</span>
                )}
                <span className="text-slate-400">{expandedPhone === customer.phone ? "▲" : "▼"}</span>
              </div>
            </button>

            {expandedPhone === customer.phone && (
              <div className="space-y-4 border-t border-slate-100 p-4 dark:border-slate-800">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      📝 Nota interna
                    </h3>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                      <input
                        type="checkbox"
                        checked={blockedDraft}
                        onChange={(e) => setBlockedDraft(e.target.checked)}
                      />
                      Bloquear cliente
                    </label>
                  </div>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Só você vê essa nota — ex: atrasa pagamento, pede pra não tocar buzina..."
                    rows={2}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  />
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setSavingNote(true);
                        await getSupabase()
                          .from("customer_notes")
                          .upsert({ store_id: store.id, phone: customer.phone, note: noteDraft.trim() || null, blocked: blockedDraft, updated_at: new Date().toISOString() });
                        setSavingNote(false);
                        setNoteSaved(true);
                        setTimeout(() => setNoteSaved(false), 2000);
                      }}
                      disabled={savingNote}
                      className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
                    >
                      {savingNote ? "Salvando…" : "Salvar"}
                    </button>
                    {noteSaved && <span className="text-xs text-green-600">Salvo!</span>}
                    {blockedDraft && <span className="text-xs text-red-600">Cliente bloqueado — não consegue mais fazer pedidos.</span>}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    🔐 Conta
                  </h3>
                  {loadingAccount && <p className="mt-1 text-sm text-slate-500">Checando…</p>}
                  {!loadingAccount && accountStatus && !accountStatus.has_account && (
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Esse cliente ainda não criou uma conta — comprou como visitante.
                    </p>
                  )}
                  {!loadingAccount && accountStatus?.has_account && (
                    <div className="mt-1 space-y-2">
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Conta ativa ({accountStatus.email_masked}){" "}
                        {accountStatus.locked && (
                          <span className="font-semibold text-red-600">— bloqueada</span>
                        )}
                      </p>
                      <button
                        onClick={() => handleResetAccess(customer)}
                        disabled={resettingAccess}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
                      >
                        {resettingAccess ? "Enviando…" : "🔓 Resetar acesso / senha"}
                      </button>
                      {resetMessage && (
                        <p className={`text-sm ${resetMessage.ok ? "text-green-600" : "text-red-600"}`}>
                          {resetMessage.text}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {customer.cashbackBalance > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      💰 Cashback
                    </h3>
                    <p className="mt-1 text-sm text-green-700 dark:text-green-400">
                      Saldo: {formatCurrency(customer.cashbackBalance)}
                      {customer.referralCode && ` · Código de indicação: ${customer.referralCode}`}
                    </p>
                  </div>
                )}

                {customer.creditCustomerId && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      🧾 Fiado
                    </h3>
                    <p
                      className={`mt-1 text-sm font-semibold ${customer.creditBalance > 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {formatCurrency(customer.creditBalance)} em aberto
                    </p>
                    <ul className="mt-2 space-y-1 text-sm">
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
                    <div className="mt-2 flex items-center gap-2">
                      {payingOpen ? (
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
                            onClick={() => handleRegisterPayment(customer)}
                            disabled={savingPayment}
                            className="rounded-lg bg-green-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                          >
                            {savingPayment ? "Salvando…" : "Confirmar"}
                          </button>
                          <button
                            onClick={() => setPayingOpen(false)}
                            className="text-sm text-slate-500 hover:underline dark:text-slate-400"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setPayingOpen(true)}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                        >
                          Registrar pagamento (baixar fiado)
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    📦 Histórico de pedidos
                  </h3>
                  {loadingOrders && <p className="mt-1 text-sm text-slate-500">Carregando…</p>}
                  {!loadingOrders && orders.length === 0 && (
                    <p className="mt-1 text-sm text-slate-500">Nenhum pedido registrado.</p>
                  )}
                  <ul className="mt-2 space-y-2">
                    {orders.map((order) => (
                      <li
                        key={order.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 text-sm dark:border-slate-800"
                      >
                        <span className="text-slate-600 dark:text-slate-400">
                          {formatDate(order.created_at)} · {formatCurrency(order.total)}
                        </span>
                        <button
                          onClick={() => reprintOrder(order)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                        >
                          🖨️ Reimprimir cupom
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
