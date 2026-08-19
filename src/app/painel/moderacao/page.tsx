"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type ModProduct = {
  id: string;
  store_id: string;
  store_name: string;
  name: string;
  category: string | null;
  price: number;
  image_url: string | null;
  active: boolean;
  created_at: string;
};

type ModBanner = {
  id: string;
  store_id: string;
  store_name: string;
  title: string;
  image_url: string;
  link_url: string | null;
  active: boolean;
  created_at: string;
};

function formatCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Moderacao() {
  const store = useStore();
  const [tab, setTab] = useState<"produtos" | "banners">("produtos");
  const [products, setProducts] = useState<ModProduct[]>([]);
  const [banners, setBanners] = useState<ModBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  async function load() {
    const supabase = getSupabase();
    const [productsRes, bannersRes] = await Promise.all([
      supabase.rpc("get_hub_moderation_products", { p_hub_store_id: store.id }),
      supabase.rpc("get_hub_moderation_banners", { p_hub_store_id: store.id }),
    ]);
    setProducts((productsRes.data as ModProduct[]) ?? []);
    setBanners((bannersRes.data as ModBanner[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function toggle(kind: "produto" | "banner", id: string, nextActive: boolean) {
    if (!nextActive) {
      const ok = confirm(
        kind === "produto"
          ? "Bloquear esse produto? Ele some da vitrine do afiliado até você reativar."
          : "Bloquear esse banner? Ele some do site até você reativar.",
      );
      if (!ok) return;
    }
    setBusyId(id);
    const { error } = await getSupabase().rpc("hub_moderate_set_active", {
      p_hub_store_id: store.id,
      p_content_type: kind,
      p_record_id: id,
      p_active: nextActive,
    });
    setBusyId(null);
    if (error) {
      alert("Não deu pra atualizar: " + error.message);
      return;
    }
    if (kind === "produto") {
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, active: nextActive } : p)));
    } else {
      setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, active: nextActive } : b)));
    }
  }

  const visibleProducts = products.filter((p) => showInactive || p.active);
  const visibleBanners = banners.filter((b) => showInactive || b.active);
  const blockedCount = products.filter((p) => !p.active).length + banners.filter((b) => !b.active).length;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Moderação</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        O que os afiliados publicam no site — bloqueie o que não fizer sentido com a política da plataforma.
      </p>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("produtos")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              tab === "produtos" ? "bg-blue-900 text-amber-300 dark:bg-blue-800" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            Produtos ({products.length})
          </button>
          <button
            onClick={() => setTab("banners")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              tab === "banners" ? "bg-blue-900 text-amber-300 dark:bg-blue-800" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            Banners ({banners.length})
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          mostrar bloqueados
        </label>
      </div>

      {blockedCount > 0 && (
        <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">{blockedCount} item(ns) bloqueado(s) hoje</p>
      )}

      {loading && <p className="mt-4 text-sm text-slate-500">Carregando…</p>}

      {!loading && tab === "produtos" && (
        <div className="mt-3 flex flex-col gap-2">
          {visibleProducts.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum produto por aqui.</p>}
          {visibleProducts.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                p.active ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" : "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10"
              }`}
            >
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt={p.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{p.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {p.store_name} · {formatCurrency(p.price)}
                  {!p.active && " · bloqueado"}
                </p>
              </div>
              <button
                onClick={() => toggle("produto", p.id, !p.active)}
                disabled={busyId === p.id}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  p.active
                    ? "border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                    : "bg-blue-900 text-amber-300 dark:bg-blue-800"
                }`}
              >
                {busyId === p.id ? "…" : p.active ? "Bloquear" : "Reativar"}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "banners" && (
        <div className="mt-3 flex flex-col gap-2">
          {visibleBanners.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum banner por aqui.</p>}
          {visibleBanners.map((b) => (
            <div
              key={b.id}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                b.active ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" : "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.image_url} alt={b.title} className="h-12 w-20 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{b.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {b.store_name}
                  {!b.active && " · bloqueado"}
                </p>
              </div>
              <button
                onClick={() => toggle("banner", b.id, !b.active)}
                disabled={busyId === b.id}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  b.active
                    ? "border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                    : "bg-blue-900 text-amber-300 dark:bg-blue-800"
                }`}
              >
                {busyId === b.id ? "…" : b.active ? "Bloquear" : "Reativar"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
