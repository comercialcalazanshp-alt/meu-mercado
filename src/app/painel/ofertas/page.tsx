"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import PhotoField from "@/components/PhotoField";

type OfferProduct = {
  id: string;
  name: string;
  price: number;
  offer_price: number;
  image_url: string | null;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildOffersPrompt(storeName: string, products: OfferProduct[]) {
  const list = products
    .slice(0, 8)
    .map((p) => `${p.name} de ${formatCurrency(p.price)} por ${formatCurrency(p.offer_price)}`)
    .join(", ");
  return [
    `Banner promocional vertical (formato story de celular) pra loja "${storeName}", anunciando ofertas do dia.`,
    list ? `Produtos em oferta: ${list}.` : "",
    "Estilo comercial de supermercado, cores vivas e chamativas, bom contraste pros preços ficarem legíveis, sem marcas d'água.",
  ]
    .filter(Boolean)
    .join(" ");
}

export default function Ofertas() {
  const store = useStore();
  const [products, setProducts] = useState<OfferProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiStoryImage, setAiStoryImage] = useState("");
  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  async function load() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("products")
      .select("id, name, price, offer_price, image_url")
      .eq("store_id", store.id)
      .eq("active", true)
      .eq("on_offer", true)
      .order("name", { ascending: true });
    setProducts((data ?? []) as OfferProduct[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  return (
    <div>
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Ofertas do dia</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Marque produtos como &quot;Em oferta hoje&quot; em Produtos (dentro de &quot;Mais
          detalhes&quot;) e eles aparecem aqui, prontos pra você postar no Status do WhatsApp — é
          só tirar um print da imagem abaixo.
        </p>
        <a
          href="/painel/produtos"
          className="mt-2 inline-block text-sm font-medium text-blue-900 underline dark:text-blue-400"
        >
          Ir pra Produtos e marcar ofertas
        </a>
      </div>

      {loading && <p className="mt-6 text-sm text-slate-500">Carregando…</p>}

      {!loading && products.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">Nenhum produto em oferta hoje.</p>
      )}

      {!loading && products.length > 0 && (
        <div className="mt-6 flex justify-center">
          <div
            id="ofertas-story"
            className="flex w-full max-w-[340px] flex-col rounded-2xl p-6 text-white shadow-lg"
            style={{
              aspectRatio: "9/16",
              background: "linear-gradient(160deg, #1e3a8a 0%, #0f1f45 100%)",
            }}
          >
            <div className="text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-blue-700 text-lg font-bold text-amber-300">
                {store.name.slice(0, 2).toUpperCase()}
              </div>
              <p className="mt-2 text-xl font-bold leading-tight">
                OFERTAS
                <br />
                DE HOJE
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-blue-200">{today}</p>
            </div>
            <div className="mt-4 flex flex-1 flex-col gap-2.5 overflow-hidden">
              {products.slice(0, 8).map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-2">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
                  ) : (
                    <div className="h-9 w-9 shrink-0 rounded-md bg-white/20" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{p.name}</span>
                  <span className="shrink-0 text-right text-[11px]">
                    <span className="block text-blue-200 line-through">{formatCurrency(p.price)}</span>
                    <span className="block font-bold text-amber-300">{formatCurrency(p.offer_price)}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-white/20 pt-2.5 text-center text-[11px] text-blue-100">
              📲 Peça pelo site · {store.name}
            </div>
          </div>
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="mx-auto mt-6 max-w-[340px] print:hidden">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Ou gere uma imagem prontinha com IA
          </p>
          <div className="mt-2">
            <PhotoField
              storeId={store.id}
              value={aiStoryImage}
              onChange={setAiStoryImage}
              uploadPrefix="oferta"
              promptSeed={buildOffersPrompt(store.name, products)}
              catalogProducts={products}
            />
          </div>
          {aiStoryImage && (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={aiStoryImage} alt="Ofertas do dia" className="w-full rounded-2xl shadow-lg" />
              <a
                href={aiStoryImage}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm font-medium text-blue-900 underline dark:text-blue-400"
              >
                ⬇️ Baixar imagem
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
