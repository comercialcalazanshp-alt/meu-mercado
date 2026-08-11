"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type ProductReview = {
  id: string;
  product_id: string;
  customer_name: string;
  rating: number;
  comment: string | null;
  created_at: string;
  products: { name: string } | null;
};

type StoreReview = {
  id: string;
  customer_name: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="font-medium text-amber-500">
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </span>
  );
}

export default function Avaliacoes() {
  const store = useStore();
  const [tab, setTab] = useState<"loja" | "produtos">("loja");
  const [storeReviews, setStoreReviews] = useState<StoreReview[]>([]);
  const [productReviews, setProductReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [minRating, setMinRating] = useState(0);

  async function load() {
    setLoading(true);
    const supabase = getSupabase();
    const [{ data: storeData }, { data: productData }] = await Promise.all([
      supabase
        .from("store_reviews")
        .select("id, customer_name, rating, comment, created_at")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("reviews")
        .select("id, product_id, customer_name, rating, comment, created_at, products(name)")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
    ]);
    setStoreReviews((storeData ?? []) as StoreReview[]);
    setProductReviews((productData ?? []) as unknown as ProductReview[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const storeAvg = useMemo(
    () => (storeReviews.length > 0 ? storeReviews.reduce((s, r) => s + r.rating, 0) / storeReviews.length : 0),
    [storeReviews],
  );
  const productAvg = useMemo(
    () =>
      productReviews.length > 0
        ? productReviews.reduce((s, r) => s + r.rating, 0) / productReviews.length
        : 0,
    [productReviews],
  );

  const filteredStoreReviews = storeReviews.filter((r) => r.rating >= minRating);
  const filteredProductReviews = productReviews.filter((r) => r.rating >= minRating);

  async function deleteStoreReview(id: string) {
    if (!confirm("Excluir essa avaliação da loja? Não dá pra desfazer.")) return;
    setStoreReviews((prev) => prev.filter((r) => r.id !== id));
    await getSupabase().from("store_reviews").delete().eq("id", id);
  }

  async function deleteProductReview(id: string) {
    if (!confirm("Excluir essa avaliação de produto? Não dá pra desfazer.")) return;
    setProductReviews((prev) => prev.filter((r) => r.id !== id));
    await getSupabase().from("reviews").delete().eq("id", id);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Avaliações</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Tudo que os clientes avaliaram — da loja em geral e de cada produto — num lugar só, pra você
        remover algo inadequado quando precisar.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Loja
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
            {storeReviews.length > 0 ? storeAvg.toFixed(1) : "—"}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {storeReviews.length === 1 ? "1 avaliação" : `${storeReviews.length} avaliações`}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Produtos
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
            {productReviews.length > 0 ? productAvg.toFixed(1) : "—"}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {productReviews.length === 1 ? "1 avaliação" : `${productReviews.length} avaliações`}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          <button
            onClick={() => setTab("loja")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === "loja"
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            Loja ({storeReviews.length})
          </button>
          <button
            onClick={() => setTab("produtos")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === "produtos"
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            Produtos ({productReviews.length})
          </button>
        </div>
        <select
          value={minRating}
          onChange={(e) => setMinRating(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value={0}>Todas as notas</option>
          <option value={4}>4 estrelas ou mais</option>
          <option value={3}>3 estrelas ou mais</option>
          <option value={1}>Só as ruins (1-2)</option>
        </select>
      </div>

      {loading && <p className="mt-6 text-sm text-slate-500">Carregando…</p>}

      {!loading && tab === "loja" && (
        <div className="mt-4 flex flex-col gap-2">
          {filteredStoreReviews.length === 0 && (
            <p className="text-sm text-slate-500">Nenhuma avaliação da loja por aqui.</p>
          )}
          {filteredStoreReviews.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Stars rating={r.rating} />{" "}
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {r.customer_name}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">{formatDate(r.created_at)}</span>
                  {r.comment && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{r.comment}</p>}
                </div>
                <button
                  onClick={() => deleteStoreReview(r.id)}
                  className="shrink-0 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "produtos" && (
        <div className="mt-4 flex flex-col gap-2">
          {filteredProductReviews.length === 0 && (
            <p className="text-sm text-slate-500">Nenhuma avaliação de produto por aqui.</p>
          )}
          {filteredProductReviews.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-blue-900 dark:text-blue-400">
                    {r.products?.name ?? "(produto removido)"}
                  </p>
                  <Stars rating={r.rating} />{" "}
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {r.customer_name}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">{formatDate(r.created_at)}</span>
                  {r.comment && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{r.comment}</p>}
                </div>
                <button
                  onClick={() => deleteProductReview(r.id)}
                  className="shrink-0 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
