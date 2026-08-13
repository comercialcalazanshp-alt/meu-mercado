"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Achievement = { emoji: string; label: string; unlocked: boolean };

export default function PainelInicio() {
  const store = useStore();
  const [productCount, setProductCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [storeUrl, setStoreUrl] = useState("");
  const [orderCount, setOrderCount] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [storeAgeDays, setStoreAgeDays] = useState(0);

  useEffect(() => {
    setStoreUrl(`${window.location.origin}/loja/${store.slug}`);

    const supabase = getSupabase();

    supabase
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("store_id", store.id)
      .then(({ count }) => setProductCount(count ?? 0));

    supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("store_id", store.id)
      .eq("status", "pendente")
      .then(({ count }) => setPendingCount(count ?? 0));

    supabase
      .from("orders")
      .select("total, status")
      .eq("store_id", store.id)
      .then(({ data }) => {
        const valid = (data ?? []).filter((o) => o.status !== "cancelado");
        setOrderCount(valid.length);
        setTotalRevenue(valid.reduce((sum, o) => sum + o.total, 0));
      });

    supabase
      .from("stores")
      .select("created_at")
      .eq("id", store.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const days = (Date.now() - new Date(data.created_at).getTime()) / (1000 * 60 * 60 * 24);
          setStoreAgeDays(days);
        }
      });
  }, [store.id, store.slug]);

  const achievements: Achievement[] = useMemo(
    () => [
      { emoji: "🎉", label: "Primeira venda", unlocked: orderCount >= 1 },
      { emoji: "🔥", label: "10 pedidos", unlocked: orderCount >= 10 },
      { emoji: "🚀", label: "50 pedidos", unlocked: orderCount >= 50 },
      { emoji: "🏆", label: "100 pedidos", unlocked: orderCount >= 100 },
      { emoji: "💰", label: `${formatCurrency(500)} em vendas`, unlocked: totalRevenue >= 500 },
      { emoji: "💰", label: `${formatCurrency(1000)} em vendas`, unlocked: totalRevenue >= 1000 },
      { emoji: "💎", label: `${formatCurrency(5000)} em vendas`, unlocked: totalRevenue >= 5000 },
      { emoji: "📦", label: "10 produtos no catálogo", unlocked: (productCount ?? 0) >= 10 },
      { emoji: "🎂", label: "1 mês de loja", unlocked: storeAgeDays >= 30 },
      { emoji: "🎂", label: "6 meses de loja", unlocked: storeAgeDays >= 182 },
      { emoji: "🎂", label: "1 ano de loja", unlocked: storeAgeDays >= 365 },
    ],
    [orderCount, totalRevenue, productCount, storeAgeDays],
  );
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Olá, {store.name}</h1>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-600 dark:text-slate-400">Link público da sua loja</p>
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block truncate text-sm font-medium text-blue-900 underline dark:text-blue-400"
        >
          {storeUrl || "carregando…"}
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <a
          href="/painel/produtos"
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {productCount ?? "–"}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">produtos cadastrados</p>
        </a>
        <a
          href="/painel/pedidos"
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {pendingCount ?? "–"}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">pedidos pendentes</p>
        </a>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Conquistas
          </h2>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {unlockedCount} de {achievements.length}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {achievements.map((a) => (
            <div
              key={a.label}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                a.unlocked
                  ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30"
                  : "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-500"
              }`}
            >
              <span className={a.unlocked ? "" : "opacity-30 grayscale"}>{a.emoji}</span>
              <span
                className={
                  a.unlocked
                    ? "text-slate-800 dark:text-slate-200"
                    : "text-slate-400 dark:text-slate-500"
                }
              >
                {a.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {productCount === 0 && (
        <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
          <h2 className="font-semibold text-blue-900 dark:text-blue-300">
            Primeiros passos pra começar a vender
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span>{productCount && productCount > 0 ? "✅" : "⬜"}</span>
              <a href="/painel/produtos" className="text-blue-900 underline dark:text-blue-400">
                Adicione seu primeiro produto
              </a>
            </li>
            <li className="flex items-center gap-2">
              <span>{store.whatsapp ? "✅" : "⬜"}</span>
              <a href="/painel/configuracoes" className="text-blue-900 underline dark:text-blue-400">
                Confirme o WhatsApp da loja
              </a>
            </li>
            <li className="flex items-center gap-2">
              <span>⬜</span>
              <a href="/painel/cartaz" className="text-blue-900 underline dark:text-blue-400">
                Gere o cartaz com QR code da loja
              </a>
            </li>
            <li className="flex items-center gap-2">
              <span>⬜</span>
              <a
                href={storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-900 underline dark:text-blue-400"
              >
                Veja como sua vitrine está ficando
              </a>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
