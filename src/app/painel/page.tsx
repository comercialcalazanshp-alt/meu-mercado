"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

export default function PainelInicio() {
  const store = useStore();
  const [productCount, setProductCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [storeUrl, setStoreUrl] = useState("");

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
  }, [store.id, store.slug]);

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
              <a href="/painel/conta" className="text-blue-900 underline dark:text-blue-400">
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
