"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { buildReceiptHtml, printHtml } from "@/lib/receipt";
import { resetCustomerAccess } from "./actions";
import { Section, PrimaryButton, SecondaryButton, IconSearch, IconChevron } from "@/components/ui";
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
  const COLOR_HEX = useThemeColors();
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

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [noteDraft, setNoteDraft] = useState("");
  const [blockedDraft, setBlockedDraft] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
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
          Tudo relacionado a um cliente num lugar só: conta/bloqueio, cashback, fiado em aberto e histórico de
          pedidos.
        </p>

        <div className="relative mt-4">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou WhatsApp"
            className="w-full rounded-xl border border-white/[0.09] bg-white/[0.035] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-white/30 backdrop-blur-xl transition focus:border-[#5CACFF]/50 focus:outline-none focus:ring-2 focus:ring-[#5CACFF]/15"
          />
        </div>

        {loading && (
          <div className="mt-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="mt-6 text-sm text-white/35">Nenhum cliente encontrado.</p>
        )}

        <div className="mt-4 space-y-3">
          {filtered.map((customer, i) => {
            const expanded = expandedPhone === customer.phone;
            return (
              <div
                key={customer.phone}
                className="animate-mm-fade-up overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.035] backdrop-blur-xl"
                style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
              >
                <button
                  onClick={() => toggleCustomer(customer)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left transition hover:bg-white/[0.03]"
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
                      <span
                        className="animate-mm-badge-bump rounded-full px-2.5 py-1 text-xs font-bold"
                        style={{ background: `${COLOR_HEX.negative}22`, color: COLOR_HEX.negative }}
                      >
                        {formatCurrency(customer.creditBalance)} fiado
                      </span>
                    )}
                    <IconChevron className={`h-4 w-4 text-white/30 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </div>
                </button>

                {expanded && (
                  <div className="animate-mm-slide-up space-y-5 border-t border-white/[0.06] p-4">
                    <Section dot="#8B8FA3" label="Nota interna">
                      <div className="flex items-center justify-between gap-2">
                        <span />
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
                        className="mt-1.5 w-full rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#5CACFF]/50 focus:outline-none"
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

                    {customer.creditCustomerId && (
                      <Section dot={COLOR_HEX.negative} label="Fiado">
                        <p className="font-semibold" style={{ color: customer.creditBalance > 0 ? COLOR_HEX.negative : COLOR_HEX.positive }}>
                          {formatCurrency(customer.creditBalance)} em aberto
                        </p>
                        <ul className="mt-2 space-y-1.5 text-sm">
                          {transactions.map((tx) => (
                            <li key={tx.id} className="flex justify-between gap-3 text-white/50">
                              <span className="truncate">
                                {tx.type === "venda" ? "Venda" : "Pagamento"}
                                {tx.note ? ` — ${tx.note}` : ""} · {formatDate(tx.created_at)}
                              </span>
                              <span
                                className="shrink-0 font-medium tabular-nums"
                                style={{ color: tx.type === "venda" ? COLOR_HEX.negative : COLOR_HEX.positive }}
                              >
                                {tx.type === "venda" ? "+" : "−"}
                                {formatCurrency(tx.amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3">
                          <Link href={`/painel/fiado?cliente=${customer.creditCustomerId}`}>
                            <PrimaryButton hex={COLOR_HEX.positive} as="span">
                              Registrar pagamento no Crediário →
                            </PrimaryButton>
                          </Link>
                        </div>
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
