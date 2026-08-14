"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import PhotoField from "@/components/PhotoField";
import { BannerOverlay, BANNER_TEXT_STYLES, type BannerTextStyle } from "@/components/BannerOverlay";

type Banner = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  start_at: string | null;
  end_at: string | null;
  active: boolean;
  focal_x: number;
  focal_y: number;
  text_style: BannerTextStyle | null;
  overlay_text: string | null;
};

type ProductOption = { id: string; name: string; image_url: string | null };

function buildBannerPrompt(title: string) {
  return [
    `Foto de fundo pra banner promocional de loja de supermercado, tema "${title.trim() || "promoção"}".`,
    "Formato retangular horizontal (bem mais largo que alto), cores vivas, estilo comercial.",
    "Não desenhe nenhum texto, letra, número ou palavra na imagem — só a foto/ilustração de fundo, sem nada escrito. O texto é adicionado depois por fora.",
  ].join(" ");
}

function toDateInputValue(iso: string | null) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function statusLabel(banner: Banner) {
  const now = new Date();
  if (!banner.active) return { text: "Inativo", style: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  if (banner.start_at && new Date(banner.start_at) > now) {
    return { text: "Agendado", style: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" };
  }
  if (banner.end_at && new Date(banner.end_at) < now) {
    return { text: "Expirado", style: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  }
  return { text: "No ar", style: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" };
}

// Mesma caixa (tamanho + corte) usada na vitrine — a prévia aqui precisa
// bater exatamente com o que o cliente vê, senão o ajuste de ponto focal e
// o estilo de texto viram achismo.
const BANNER_BOX_CLASS = "relative h-40 w-full overflow-hidden rounded-2xl shadow-sm sm:h-52 sm:w-[26rem]";

export default function Banners() {
  const store = useStore();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [focalX, setFocalX] = useState(0.5);
  const [focalY, setFocalY] = useState(0.5);
  const [textStyle, setTextStyle] = useState<BannerTextStyle | null>(null);
  const [overlayText, setOverlayText] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);

  async function loadBanners() {
    setLoading(true);
    const [{ data }, { data: productsData }] = await Promise.all([
      getSupabase()
        .from("banners")
        .select("id, title, image_url, link_url, start_at, end_at, active, focal_x, focal_y, text_style, overlay_text")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
      getSupabase()
        .from("products")
        .select("id, name, image_url")
        .eq("store_id", store.id)
        .eq("active", true)
        .order("name"),
    ]);
    setBanners(data ?? []);
    setProducts(productsData ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadBanners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  function resetForm() {
    setTitle("");
    setImageUrl("");
    setLinkUrl("");
    setStartAt("");
    setEndAt("");
    setFocalX(0.5);
    setFocalY(0.5);
    setTextStyle(null);
    setOverlayText("");
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !imageUrl.trim()) {
      setError("Preencha o título e a imagem.");
      return;
    }

    setSaving(true);
    const { error: insertError } = await getSupabase().from("banners").insert({
      store_id: store.id,
      title: title.trim(),
      image_url: imageUrl.trim(),
      link_url: linkUrl.trim() || null,
      start_at: startAt ? new Date(startAt).toISOString() : null,
      end_at: endAt ? new Date(endAt + "T23:59:59").toISOString() : null,
      focal_x: focalX,
      focal_y: focalY,
      text_style: textStyle,
      overlay_text: textStyle ? overlayText.trim() || null : null,
    });
    setSaving(false);

    if (insertError) {
      setError("Não deu pra salvar o banner: " + insertError.message);
      return;
    }

    resetForm();
    loadBanners();
  }

  function handleFocalClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setFocalX(Math.min(1, Math.max(0, x)));
    setFocalY(Math.min(1, Math.max(0, y)));
  }

  async function toggleActive(id: string, active: boolean) {
    setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, active } : b)));
    await getSupabase().from("banners").update({ active }).eq("id", id);
  }

  async function deleteBanner(id: string, bannerTitle: string) {
    if (!window.confirm(`Excluir o banner "${bannerTitle}"?`)) return;
    setBanners((prev) => prev.filter((b) => b.id !== id));
    await getSupabase().from("banners").delete().eq("id", id);
  }

  function shareTextFor(banner: Banner) {
    const storeUrl = `${window.location.origin}/loja/${store.slug}`;
    return `${banner.title} — confira na ${store.name}! ${banner.link_url || storeUrl}`;
  }

  async function handleShareBanner(banner: Banner) {
    if (!navigator.share) {
      setFallbackFor(fallbackFor === banner.id ? null : banner.id);
      return;
    }

    setSharingId(banner.id);
    const shareText = shareTextFor(banner);
    try {
      try {
        const response = await fetch(banner.image_url);
        const blob = await response.blob();
        const file = new File([blob], "banner.jpg", { type: blob.type || "image/jpeg" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: banner.title, text: shareText });
          return;
        }
      } catch {
        // não deu pra baixar a imagem (CORS, etc.) — compartilha só o texto/link abaixo
      }
      await navigator.share({ title: banner.title, text: shareText, url: banner.image_url });
    } catch (err) {
      if ((err as Error).name !== "AbortError") setFallbackFor(banner.id);
    } finally {
      setSharingId(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Banners e ofertas agendadas
      </h1>

      <form
        onSubmit={handleAdd}
        className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título interno (ex: Promoção de fim de semana)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 sm:col-span-2"
        />
        <div className="sm:col-span-2">
          <PhotoField
            storeId={store.id}
            value={imageUrl}
            onChange={(url) => {
              setImageUrl(url);
              setFocalX(0.5);
              setFocalY(0.5);
            }}
            uploadPrefix="banner"
            promptSeed={buildBannerPrompt(title)}
            catalogProducts={products}
            imageSize="1536x1024"
          />
        </div>

        {imageUrl && (
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Clique na imagem no ponto que não pode sumir (ex: o produto, o rosto) — o site sempre
              mantém esse ponto visível, mesmo cortando o resto pra caber na tela.
            </p>
            <div className={`${BANNER_BOX_CLASS} mt-2 cursor-crosshair`} onClick={handleFocalClick}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt=""
                className="h-full w-full object-cover"
                style={{ objectPosition: `${focalX * 100}% ${focalY * 100}%` }}
              />
              <div
                className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-500/90 shadow"
                style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
              />
              <BannerOverlay style={textStyle} text={overlayText} />
            </div>

            <div className="mt-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Texto sobre a imagem (opcional)
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTextStyle(null)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    textStyle === null
                      ? "border-blue-900 bg-blue-900 text-amber-300 dark:border-blue-700 dark:bg-blue-800"
                      : "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  }`}
                >
                  Sem texto
                </button>
                {BANNER_TEXT_STYLES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTextStyle(opt.value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      textStyle === opt.value
                        ? "border-blue-900 bg-blue-900 text-amber-300 dark:border-blue-700 dark:bg-blue-800"
                        : "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {textStyle && (
                <input
                  value={overlayText}
                  onChange={(e) => setOverlayText(e.target.value)}
                  placeholder="Ex: 10% OFF hoje"
                  maxLength={40}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                />
              )}
            </div>
          </div>
        )}

        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Link ao clicar (opcional)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 sm:col-span-2"
        />
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
            Começa em (opcional)
          </label>
          <input
            type="date"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
            Termina em (opcional)
          </label>
          <input
            type="date"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800 sm:col-span-2"
        >
          {saving ? "Salvando…" : "Criar banner"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-6 space-y-3">
        {loading && <p className="text-sm text-slate-500">Carregando…</p>}
        {!loading && banners.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum banner criado ainda.</p>
        )}
        {banners.map((banner) => {
          const status = statusLabel(banner);
          return (
            <div
              key={banner.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative h-20 w-full shrink-0 overflow-hidden rounded-lg sm:w-32">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={banner.image_url}
                    alt={banner.title}
                    className="h-full w-full object-cover"
                    style={{ objectPosition: `${banner.focal_x * 100}% ${banner.focal_y * 100}%` }}
                  />
                  <BannerOverlay style={banner.text_style} text={banner.overlay_text} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-50">{banner.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {banner.start_at || banner.end_at
                      ? `${banner.start_at ? toDateInputValue(banner.start_at) : "sem início"} até ${
                          banner.end_at ? toDateInputValue(banner.end_at) : "sem fim"
                        }`
                      : "Sem prazo definido"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.style}`}
                >
                  {status.text}
                </span>
                <button
                  onClick={() => handleShareBanner(banner)}
                  disabled={sharingId === banner.id}
                  className="shrink-0 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  {sharingId === banner.id ? "Abrindo…" : "Publicar"}
                </button>
                <button
                  onClick={() => toggleActive(banner.id, !banner.active)}
                  className="shrink-0 text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
                >
                  {banner.active ? "Desativar" : "Ativar"}
                </button>
                <button
                  onClick={() => deleteBanner(banner.id, banner.title)}
                  className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                >
                  Excluir
                </button>
              </div>

              {fallbackFor === banner.id && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Compartilhamento direto não disponível nesse navegador — use:
                  </span>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(shareTextFor(banner) + " " + banner.image_url)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-green-600 hover:underline"
                  >
                    Compartilhar no WhatsApp
                  </a>
                  <a
                    href={banner.image_url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-900 hover:underline dark:text-blue-400"
                  >
                    Baixar imagem
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
