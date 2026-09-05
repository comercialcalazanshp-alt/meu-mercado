"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Product = {
  id: string;
  name: string;
  price: number;
  cost_price: number | null;
  category: string | null;
  stock: number;
  stock_alert_threshold: number | null;
  expiry_date: string | null;
};

type OrderItem = {
  name: string;
  product_id?: string;
  created_at?: string;
};

type Order = {
  id: string;
  customer_name: string;
  status: string;
  created_at: string;
  out_for_delivery_at: string | null;
  items: { name: string; product_id?: string }[];
};

type CreditCustomer = {
  id: string;
  name: string;
  balance: number;
  credit_limit: number | null;
};

const STALLED_MINUTES = 20;
const DELIVERY_DELAY_MINUTES = 45;
const EXPIRY_WARNING_DAYS = 7;
const SOLD_WITHOUT_COST_DAYS = 30;

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

type Severity = "critico" | "atencao" | "info";

const SEVERITY_STYLE: Record<Severity, { dot: string; badge: string }> = {
  critico: { dot: "bg-red-500", badge: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
  atencao: { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  info: { dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
};

type AlertGroup = {
  key: string;
  title: string;
  severity: Severity;
  explanation: string;
  items: { label: string; detail?: string }[];
};

export default function Alertas() {
  const store = useStore();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [creditCustomers, setCreditCustomers] = useState<CreditCustomer[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = getSupabase();
      const since30d = new Date();
      since30d.setDate(since30d.getDate() - SOLD_WITHOUT_COST_DAYS);

      // O Supabase corta em 1000 linhas por página — uma loja com mais de
      // 1000 produtos ativos (é o caso aqui) perderia produto sem aviso
      // nenhum se a busca não paginar até o fim.
      const PAGE_SIZE = 1000;
      async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) {
        const all: T[] = [];
        let from = 0;
        while (true) {
          const { data } = await build(from, from + PAGE_SIZE - 1);
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
        return all;
      }

      const [productsData, ordersData, creditData] = await Promise.all([
        fetchAll<Product>((from, to) =>
          supabase
            .from("products")
            .select("id, name, price, cost_price, category, stock, stock_alert_threshold, expiry_date")
            .eq("store_id", store.id)
            .eq("active", true)
            .range(from, to),
        ),
        fetchAll<Order>((from, to) =>
          supabase
            .from("orders")
            .select("id, customer_name, status, created_at, out_for_delivery_at, items")
            .eq("store_id", store.id)
            .gte("created_at", since30d.toISOString())
            .range(from, to),
        ),
        fetchAll<CreditCustomer>((from, to) =>
          supabase
            .from("credit_customers")
            .select("id, name, balance, credit_limit")
            .eq("store_id", store.id)
            .range(from, to),
        ),
      ]);

      setProducts(productsData);
      setOrders(ordersData);
      setCreditCustomers(creditData);
      setLoading(false);
    }
    load();
  }, [store.id]);

  const groups = useMemo<AlertGroup[]>(() => {
    const now = new Date();
    const result: AlertGroup[] = [];

    // Pedidos parados sem confirmar
    const stalledCutoff = new Date(now.getTime() - STALLED_MINUTES * 60 * 1000);
    const stalledOrders = orders.filter(
      (o) => (o.status === "pendente" || o.status === "confirmado") && new Date(o.created_at) < stalledCutoff,
    );
    if (stalledOrders.length > 0) {
      result.push({
        key: "pedidos_parados",
        title: "Pedidos parados sem confirmar",
        severity: "critico",
        explanation: `Pedido aberto há mais de ${STALLED_MINUTES} minutos sem confirmar ou recusar.`,
        items: stalledOrders.map((o) => ({
          label: o.customer_name,
          detail: `há ${Math.round((now.getTime() - new Date(o.created_at).getTime()) / 60000)} min`,
        })),
      });
    }

    // Entregas demorando
    const deliveryCutoff = new Date(now.getTime() - DELIVERY_DELAY_MINUTES * 60 * 1000);
    const delayedOrders = orders.filter(
      (o) => o.status === "entregando" && o.out_for_delivery_at && new Date(o.out_for_delivery_at) < deliveryCutoff,
    );
    if (delayedOrders.length > 0) {
      result.push({
        key: "entregas_demorando",
        title: "Entregas demorando",
        severity: "atencao",
        explanation: `Saiu pra entrega há mais de ${DELIVERY_DELAY_MINUTES} minutos e ainda não foi marcado como entregue.`,
        items: delayedOrders.map((o) => ({
          label: o.customer_name,
          detail: `há ${Math.round((now.getTime() - new Date(o.out_for_delivery_at!).getTime()) / 60000)} min`,
        })),
      });
    }

    // Estoque baixo (só quem tem limite configurado)
    const lowStock = products.filter(
      (p) => p.stock_alert_threshold !== null && p.stock <= p.stock_alert_threshold,
    );
    if (lowStock.length > 0) {
      result.push({
        key: "estoque_baixo",
        title: "Estoque baixo",
        severity: "atencao",
        explanation: "Estoque já chegou (ou passou) do limite de alerta que você configurou em Produtos.",
        items: lowStock.map((p) => ({ label: p.name, detail: `estoque: ${p.stock}` })),
      });
    }

    // Produtos com margem negativa (custo maior que o preço de venda)
    const negativeMargin = products.filter(
      (p) => p.cost_price !== null && p.cost_price > p.price,
    );
    if (negativeMargin.length > 0) {
      result.push({
        key: "margem_negativa",
        title: "Produtos vendendo no prejuízo",
        severity: "critico",
        explanation: "Preço de custo cadastrado é maior que o preço de venda — cada venda desse produto dá prejuízo.",
        items: negativeMargin.map((p) => ({
          label: p.name,
          detail: `custo ${formatCurrency(p.cost_price!)} > venda ${formatCurrency(p.price)}`,
        })),
      });
    }

    // Vendidos recentemente sem custo cadastrado — separa quem ainda existe
    // no catálogo (dá pra preencher o custo) de quem já foi excluído (não dá
    // mais pra preencher nada, o cadastro não existe mais; o join do
    // get_profit_summary com products simplesmente ignora essas linhas, ou
    // seja o custo delas nem entra na conta — lucro fica um pouco
    // superestimado, não subestimado, pra essas vendas específicas).
    const soldWithoutCostNames = new Map<string, string>();
    const soldDeletedProductNames = new Map<string, string>();
    const productById = new Map(products.map((p) => [p.id, p]));
    for (const order of orders) {
      if (order.status === "cancelado") continue;
      for (const item of order.items ?? []) {
        if (!item.product_id) continue;
        const product = productById.get(item.product_id);
        if (!product) {
          soldDeletedProductNames.set(item.product_id, item.name);
        } else if (product.cost_price === null) {
          soldWithoutCostNames.set(item.product_id, item.name);
        }
      }
    }
    if (soldWithoutCostNames.size > 0) {
      result.push({
        key: "vendido_sem_custo",
        title: "Vendidos sem preço de custo cadastrado",
        severity: "atencao",
        explanation: `Teve venda nos últimos ${SOLD_WITHOUT_COST_DAYS} dias desses produtos, mas sem custo cadastrado — o lucro real fica subestimado enquanto isso não for preenchido.`,
        items: Array.from(soldWithoutCostNames.values()).map((label) => ({ label })),
      });
    }
    if (soldDeletedProductNames.size > 0) {
      result.push({
        key: "vendido_produto_excluido",
        title: "Vendas de produtos já excluídos do catálogo",
        severity: "info",
        explanation: `Teve venda nos últimos ${SOLD_WITHOUT_COST_DAYS} dias desses produtos, mas o cadastro foi excluído depois — não tem mais como preencher custo, e essas vendas não entram na conta de custo dos relatórios (o lucro fica um pouco superestimado só nelas).`,
        items: Array.from(soldDeletedProductNames.values()).map((label) => ({ label })),
      });
    }

    // Produtos sem categoria
    const noCategory = products.filter((p) => !p.category || !p.category.trim());
    if (noCategory.length > 0) {
      result.push({
        key: "sem_categoria",
        title: "Produtos sem categoria",
        severity: "info",
        explanation: "Sem categoria, o produto fica mais difícil de achar na vitrine e nos relatórios por categoria.",
        items: noCategory.map((p) => ({ label: p.name })),
      });
    }

    // Vencidos ou vencendo em breve
    const expiryCutoff = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);
    const expiring = products.filter((p) => p.expiry_date && new Date(p.expiry_date) < expiryCutoff);
    if (expiring.length > 0) {
      result.push({
        key: "vencimento",
        title: "Vencidos ou vencendo em breve",
        severity: "critico",
        explanation: `Data de validade já passou ou vence nos próximos ${EXPIRY_WARNING_DAYS} dias.`,
        items: expiring
          .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
          .map((p) => ({
            label: p.name,
            detail: new Date(p.expiry_date!) < now ? `venceu em ${formatDate(p.expiry_date!)}` : `vence em ${formatDate(p.expiry_date!)}`,
          })),
      });
    }

    // Fiado perto ou acima do limite de crédito
    const nearLimit = creditCustomers.filter(
      (c) => c.credit_limit !== null && c.credit_limit > 0 && c.balance >= c.credit_limit * 0.9,
    );
    if (nearLimit.length > 0) {
      result.push({
        key: "fiado_limite",
        title: "Fiado perto ou acima do limite",
        severity: "atencao",
        explanation: "Saldo devedor já chegou a 90% (ou mais) do limite de crédito cadastrado pra esse cliente.",
        items: nearLimit.map((c) => ({
          label: c.name,
          detail: `${formatCurrency(c.balance)} de ${formatCurrency(c.credit_limit!)}`,
        })),
      });
    }

    const order: Record<Severity, number> = { critico: 0, atencao: 1, info: 2 };
    return result.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [products, orders, creditCustomers]);

  const totalAlerts = groups.reduce((sum, g) => sum + g.items.length, 0);

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Central de Alertas</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Tudo que merece sua atenção agora, num lugar só — recalculado toda vez que você abre essa página.
        </p>
      </div>

      {totalAlerts === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            Tudo certo por aqui — nenhum alerta no momento.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const style = SEVERITY_STYLE[group.severity];
            const isOpen = expandedKey === group.key;
            return (
              <div
                key={group.key}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <button
                  onClick={() => setExpandedKey(isOpen ? null : group.key)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                        {group.title}
                      </p>
                      <p className="mt-0.5 hidden text-xs text-slate-500 dark:text-slate-400 sm:block">
                        {group.explanation}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${style.badge}`}>
                      {group.items.length}
                    </span>
                    <span className="text-slate-400">{isOpen ? "▲" : "▼"}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                    <p className="mb-2 text-xs text-slate-500 dark:text-slate-400 sm:hidden">{group.explanation}</p>
                    <ul className="space-y-1.5">
                      {group.items.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2 text-sm text-slate-700 dark:text-slate-300"
                        >
                          <span className="truncate">{item.label}</span>
                          {item.detail && (
                            <span className="shrink-0 text-xs text-slate-400">{item.detail}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
