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
  blocked_by_hub: boolean;
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
  blocked_by_hub: boolean;
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
  const [showBlocked, setShowBlocked] = useState(true);

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

  // p_active aqui significa "deve ficar liberado" (true) ou "bloqueado"
  // (false) — a função no banco traduz isso pra blocked_by_hub, que é uma
  // trava separada do "active" que o próprio afiliado controla. Assim
  // nenhum dos dois lados desfaz a decisão do outro sozinho.
  async function toggle(kind: "produto" | "banner", id: string, shouldBeAllowed: boolean) {
    if (!shouldBeAllowed) {
      const ok = confirm(
        kind === "produto"
          ? "Bloquear esse produto? Ele some da vitrine na hora, mesmo que o afiliado tente reativar do lado dele."
          : "Bloquear esse banner? Ele some do site na hora, mesmo que o afiliado tente reativar do lado dele.",
      );
      if (!ok) return;
    }
    setBusyId(id);
    const { error } = await getSupabase().rpc("hub_moderate_set_active", {
      p_hub_store_id: store.id,
      p_content_type: kind,
      p_record_id: id,
      p_active: shouldBeAllowed,
    });
    setBusyId(null);
    if (error) {
      alert("Não deu pra atualizar: " + error.message);
      return;
    }
    if (kind === "produto") {
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, blocked_by_hub: !shouldBeAllowed } : p)));
    } else {
      setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, blocked_by_hub: !shouldBeAllowed } : b)));
    }
  }

  const visibleProducts = products.filter((p) => showBlocked || !p.blocked_by_hub);
  const visibleBanners = banners.filter((b) => showBlocked || !b.blocked_by_hub);
  const blockedCount = products.filter((p) => p.blocked_by_hub).length + banners.filter((b) => b.blocked_by_hub).length;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-white">Moderação</h1>
      <p className="mt-1 text-sm text-white/40">
        O que os afiliados publicam no site — bloqueie o que não fizer sentido com a política da plataforma. É uma
        trava sua, separada: o afiliado não consegue desfazer bloqueando/reativando do lado dele.
      </p>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("produtos")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              tab === "produtos" ? "bg-blue-900 text-amber-300" : "text-white/40"
            }`}
          >
            Produtos ({products.length})
          </button>
          <button
            onClick={() => setTab("banners")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              tab === "banners" ? "bg-blue-900 text-amber-300" : "text-white/40"
            }`}
          >
            Banners ({banners.length})
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-white/35">
          <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} />
          mostrar bloqueados
        </label>
      </div>

      {blockedCount > 0 && (
        <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">{blockedCount} item(ns) bloqueado(s) por você</p>
      )}

      {loading && <p className="mt-4 text-sm text-white/40">Carregando…</p>}

      {!loading && tab === "produtos" && (
        <div className="mt-3 flex flex-col gap-2">
          {visibleProducts.length === 0 && <p className="text-sm text-white/40">Nenhum produto por aqui.</p>}
          {visibleProducts.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                p.blocked_by_hub
                  ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10"
                  : "border-white/[0.09] bg-white/[0.035]"
              }`}
            >
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt={p.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="h-12 w-12 shrink-0 rounded-lg bg-white/[0.04]" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{p.name}</p>
                <p className="text-xs text-white/35">
                  {p.store_name} · {formatCurrency(p.price)}
                  {p.blocked_by_hub && " · bloqueado por você"}
                  {!p.blocked_by_hub && !p.active && " · pausado pelo afiliado"}
                </p>
              </div>
              <button
                onClick={() => toggle("produto", p.id, p.blocked_by_hub)}
                disabled={busyId === p.id}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  p.blocked_by_hub
                    ? "bg-blue-900 text-amber-300 dark:bg-blue-800"
                    : "border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                }`}
              >
                {busyId === p.id ? "…" : p.blocked_by_hub ? "Liberar" : "Bloquear"}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "banners" && (
        <div className="mt-3 flex flex-col gap-2">
          {visibleBanners.length === 0 && <p className="text-sm text-white/40">Nenhum banner por aqui.</p>}
          {visibleBanners.map((b) => (
            <div
              key={b.id}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                b.blocked_by_hub
                  ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10"
                  : "border-white/[0.09] bg-white/[0.035]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.image_url} alt={b.title} className="h-12 w-20 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{b.title}</p>
                <p className="text-xs text-white/35">
                  {b.store_name}
                  {b.blocked_by_hub && " · bloqueado por você"}
                  {!b.blocked_by_hub && !b.active && " · pausado pelo afiliado"}
                </p>
              </div>
              <button
                onClick={() => toggle("banner", b.id, b.blocked_by_hub)}
                disabled={busyId === b.id}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  b.blocked_by_hub
                    ? "bg-blue-900 text-amber-300 dark:bg-blue-800"
                    : "border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                }`}
              >
                {busyId === b.id ? "…" : b.blocked_by_hub ? "Liberar" : "Bloquear"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
