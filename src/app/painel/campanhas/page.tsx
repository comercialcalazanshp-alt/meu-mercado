"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Customer = {
  id: string;
  name: string | null;
  phone: string;
  cashback_balance: number;
  birthday: string | null;
};

type Segment = "todos" | "inativos" | "aniversariantes" | "cashback";

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "todos", label: "Todos os clientes" },
  { value: "inativos", label: "Não compram há mais de 30 dias" },
  { value: "aniversariantes", label: "Aniversariantes do mês" },
  { value: "cashback", label: "Com saldo de cashback" },
];

const DEFAULT_MESSAGE =
  "Oi {nome}! Passando pra avisar que temos novidades na loja. Dá uma olhada quando puder 😊";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Campanhas() {
  const store = useStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lastOrderByCustomer, setLastOrderByCustomer] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<Segment>("todos");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = getSupabase();

      const [{ data: customerRows }, { data: orderRows }] = await Promise.all([
        supabase
          .from("customers")
          .select("id, name, phone, cashback_balance, birthday")
          .eq("store_id", store.id),
        supabase
          .from("orders")
          .select("customer_id, created_at")
          .eq("store_id", store.id)
          .not("customer_id", "is", null)
          .order("created_at", { ascending: false }),
      ]);

      setCustomers(customerRows ?? []);

      const lastOrder: Record<string, string> = {};
      for (const order of orderRows ?? []) {
        if (order.customer_id && !lastOrder[order.customer_id]) {
          lastOrder[order.customer_id] = order.created_at;
        }
      }
      setLastOrderByCustomer(lastOrder);
      setLoading(false);
    }
    load();
  }, [store.id]);

  const filteredCustomers = useMemo(() => {
    const now = Date.now();
    const thisMonth = new Date().getMonth();

    return customers.filter((c) => {
      if (segment === "cashback") return c.cashback_balance > 0;
      if (segment === "aniversariantes") {
        return c.birthday && new Date(c.birthday + "T00:00:00").getMonth() === thisMonth;
      }
      if (segment === "inativos") {
        const lastOrder = lastOrderByCustomer[c.id];
        if (!lastOrder) return true;
        const daysSince = (now - new Date(lastOrder).getTime()) / (1000 * 60 * 60 * 24);
        return daysSince > 30;
      }
      return true;
    });
  }, [customers, segment, lastOrderByCustomer]);

  function whatsappUrl(customer: Customer) {
    const personalized = message.replace(/\{nome\}/g, customer.name || "cliente");
    return `https://wa.me/55${customer.phone.replace(/\D/g, "")}?text=${encodeURIComponent(personalized)}`;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Campanha no WhatsApp</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Escolha um grupo de clientes, escreva a mensagem e clique em cada um pra abrir o WhatsApp já
        com o texto pronto. Nada é enviado automaticamente — você confirma o envio um por um.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Grupo de clientes
          </label>
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value as Segment)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          >
            {SEGMENTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Mensagem
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Use {"{nome}"} pra colocar o nome do cliente automaticamente.
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">WhatsApp</th>
              <th className="px-3 py-2 font-medium">Cashback</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {loading && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && filteredCustomers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  Nenhum cliente nesse grupo.
                </td>
              </tr>
            )}
            {filteredCustomers.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-50">
                  {c.name || "—"}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{c.phone}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {c.cashback_balance > 0 ? formatCurrency(c.cashback_balance) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={whatsappUrl(c)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Enviar no WhatsApp
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && filteredCustomers.length > 0 && (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          {filteredCustomers.length}{" "}
          {filteredCustomers.length === 1 ? "cliente nesse grupo" : "clientes nesse grupo"}.
        </p>
      )}
    </div>
  );
}
