"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type OverdueCustomer = {
  id: string;
  name: string;
  phone: string;
  balance: number;
};

type BirthdayCustomer = {
  id: string;
  name: string | null;
  phone: string;
  birthday: string;
};

type InactiveCustomer = {
  id: string;
  name: string | null;
  phone: string;
  lastOrderAt: string;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function waUrl(phone: string, message: string) {
  return `https://wa.me/55${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

const INACTIVE_DAYS = 30;

export default function Mensagens() {
  const store = useStore();
  const [loading, setLoading] = useState(true);
  const [overdue, setOverdue] = useState<OverdueCustomer[]>([]);
  const [birthdays, setBirthdays] = useState<BirthdayCustomer[]>([]);
  const [inactive, setInactive] = useState<InactiveCustomer[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const dismissedStorageKey = `mensagens-dispensadas:${store.id}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(dismissedStorageKey);
      if (saved) setDismissed(new Set(JSON.parse(saved)));
    } catch {
      // localStorage indisponível — segue sem lembrar dispensados
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function load() {
    setLoading(true);
    const supabase = getSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().getMonth();
    const inactiveSince = new Date();
    inactiveSince.setDate(inactiveSince.getDate() - INACTIVE_DAYS);

    const [{ data: creditCustomers }, { data: overdueTx }, { data: allCustomers }, { data: orders }] =
      await Promise.all([
        supabase
          .from("credit_customers")
          .select("id, name, phone, balance")
          .eq("store_id", store.id)
          .gt("balance", 0),
        supabase
          .from("credit_transactions")
          .select("customer_id, credit_customers!inner(store_id)")
          .eq("type", "venda")
          .not("due_date", "is", null)
          .lt("due_date", today)
          .eq("credit_customers.store_id", store.id),
        supabase.from("customers").select("id, name, phone, birthday").eq("store_id", store.id),
        supabase
          .from("orders")
          .select("customer_id, created_at")
          .eq("store_id", store.id)
          .not("customer_id", "is", null)
          .order("created_at", { ascending: false }),
      ]);

    const overdueIds = new Set((overdueTx ?? []).map((t) => t.customer_id as string));
    setOverdue(((creditCustomers ?? []) as OverdueCustomer[]).filter((c) => overdueIds.has(c.id)));

    setBirthdays(
      ((allCustomers ?? []) as { id: string; name: string | null; phone: string; birthday: string | null }[]).filter(
        (c) => c.birthday && new Date(c.birthday + "T00:00:00").getMonth() === month,
      ) as BirthdayCustomer[],
    );

    const lastOrderByCustomer = new Map<string, string>();
    for (const o of orders ?? []) {
      const id = o.customer_id as string;
      if (!lastOrderByCustomer.has(id)) lastOrderByCustomer.set(id, o.created_at as string);
    }
    const inactiveList: InactiveCustomer[] = [];
    for (const c of (allCustomers ?? []) as { id: string; name: string | null; phone: string }[]) {
      const lastOrderAt = lastOrderByCustomer.get(c.id);
      if (lastOrderAt && new Date(lastOrderAt) < inactiveSince) {
        inactiveList.push({ id: c.id, name: c.name, phone: c.phone, lastOrderAt });
      }
    }
    setInactive(inactiveList);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const totalPending = useMemo(
    () =>
      overdue.filter((c) => !dismissed.has(`overdue-${c.id}`)).length +
      birthdays.filter((c) => !dismissed.has(`birthday-${c.id}`)).length +
      inactive.filter((c) => !dismissed.has(`inactive-${c.id}`)).length,
    [overdue, birthdays, inactive, dismissed],
  );

  function dismiss(key: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(key);
      try {
        localStorage.setItem(dismissedStorageKey, JSON.stringify([...next]));
      } catch {
        // localStorage indisponível — dispensa só nessa sessão
      }
      return next;
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Central de mensagens</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Tudo que vale mandar mensagem pra um cliente hoje, num lugar só — cobrança de fiado atrasado,
        aniversariante do mês e cliente que sumiu. Cada mensagem já vem pronta pro WhatsApp, você só
        confere e manda.
      </p>

      {!loading && totalPending === 0 && (
        <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          Nada pendente por aqui agora. 🎉
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-slate-500">Carregando…</p>}

      {overdue.some((c) => !dismissed.has(`overdue-${c.id}`)) && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            💳 Fiado atrasado
          </h2>
          <div className="mt-2 flex flex-col gap-2">
            {overdue
              .filter((c) => !dismissed.has(`overdue-${c.id}`))
              .map((c) => {
                const message = `Oi, ${c.name}! Passando pra lembrar que você tem ${formatCurrency(
                  c.balance,
                )} em aberto no fiado aqui na ${store.name}, com vencimento já passado. Consegue dar uma passadinha ou fazer o pagamento? Qualquer coisa é só chamar 🙂`;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-50">{c.name}</p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {c.phone} · deve {formatCurrency(c.balance)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <a
                        href={waUrl(c.phone, message)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-semibold text-amber-300 dark:bg-blue-800"
                      >
                        Cobrar no WhatsApp
                      </a>
                      <button
                        onClick={() => dismiss(`overdue-${c.id}`)}
                        className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      >
                        dispensar
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {birthdays.some((c) => !dismissed.has(`birthday-${c.id}`)) && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            🎂 Aniversariante do mês
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Quer mandar um cupom junto? Gere em{" "}
            <a href="/painel/cashback" className="underline">
              Cashback
            </a>
            .
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {birthdays
              .filter((c) => !dismissed.has(`birthday-${c.id}`))
              .map((c) => {
                const message = `Feliz aniversário${c.name ? ", " + c.name : ""}! 🎉 Toda a equipe da ${
                  store.name
                } deseja um dia ótimo pra você!`;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-50">
                        {c.name || c.phone}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {c.phone} · aniversário {formatDate(c.birthday)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <a
                        href={waUrl(c.phone, message)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-semibold text-amber-300 dark:bg-blue-800"
                      >
                        Parabenizar no WhatsApp
                      </a>
                      <button
                        onClick={() => dismiss(`birthday-${c.id}`)}
                        className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      >
                        dispensar
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {inactive.some((c) => !dismissed.has(`inactive-${c.id}`)) && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">
            👋 Cliente sumido (recompra)
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Já comprou antes e não volta há mais de {INACTIVE_DAYS} dias.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {inactive
              .filter((c) => !dismissed.has(`inactive-${c.id}`))
              .map((c) => {
                const message = `Oi${c.name ? ", " + c.name : ""}! Faz tempo que você não aparece por aqui na ${
                  store.name
                } — sentimos sua falta! Dá uma olhada nas novidades e ofertas dessa semana 😉`;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-50">
                        {c.name || c.phone}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {c.phone} · última compra {formatDate(c.lastOrderAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <a
                        href={waUrl(c.phone, message)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-semibold text-amber-300 dark:bg-blue-800"
                      >
                        Chamar de volta no WhatsApp
                      </a>
                      <button
                        onClick={() => dismiss(`inactive-${c.id}`)}
                        className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      >
                        dispensar
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
