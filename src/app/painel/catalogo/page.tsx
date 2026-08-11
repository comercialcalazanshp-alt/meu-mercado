"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Product = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  image_url: string | null;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Catalogo() {
  const store = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSupabase()
      .from("products")
      .select("id, name, category, price, image_url")
      .eq("store_id", store.id)
      .eq("active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .then(({ data }) => {
        setProducts(data ?? []);
        setLoading(false);
      });
  }, [store.id]);

  const categories = Array.from(
    products.reduce((groups, product) => {
      const key = product.category || "Outros";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(product);
      return groups;
    }, new Map<string, Product[]>()),
  );

  const today = new Date().toLocaleDateString("pt-BR");

  return (
    <div>
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Catálogo completo em PDF
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Uma lista com todos os produtos ativos, pronta pra imprimir ou salvar como PDF e mandar
          pro cliente que prefere ver tudo de uma vez.
        </p>
        <button
          onClick={() => window.print()}
          disabled={loading || products.length === 0}
          className="mt-4 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          Imprimir / salvar como PDF
        </button>
        {!loading && products.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">Nenhum produto ativo cadastrado ainda.</p>
        )}
      </div>

      <div id="catalogo-print-area" className="mx-auto mt-6 max-w-3xl">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900">{store.name}</h2>
          <p className="text-sm text-slate-500">Catálogo de produtos · {today}</p>
        </div>

        {categories.map(([category, items]) => (
          <div key={category} className="mb-6 break-inside-avoid">
            <h3 className="mb-2 border-b border-slate-300 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">
              {category}
            </h3>
            <div className="space-y-2">
              {items.map((product) => (
                <div key={product.id} className="flex items-center gap-3 break-inside-avoid">
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="h-12 w-12 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded bg-slate-100" />
                  )}
                  <span className="flex-1 text-sm text-slate-800">{product.name}</span>
                  <span className="text-sm font-semibold text-slate-900">
                    {formatCurrency(product.price)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:hidden,
          .print\\:hidden * {
            visibility: hidden !important;
          }
          #catalogo-print-area,
          #catalogo-print-area * {
            visibility: visible;
          }
          #catalogo-print-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
