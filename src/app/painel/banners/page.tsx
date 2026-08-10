"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Banner = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  start_at: string | null;
  end_at: string | null;
  active: boolean;
};

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

export default function Banners() {
  const store = useStore();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadBanners() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("banners")
      .select("id, title, image_url, link_url, start_at, end_at, active")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    setBanners(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadBanners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !imageUrl.trim()) {
      setError("Preencha o título e o link da imagem.");
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
    });
    setSaving(false);

    if (insertError) {
      setError("Não deu pra salvar o banner: " + insertError.message);
      return;
    }

    setTitle("");
    setImageUrl("");
    setLinkUrl("");
    setStartAt("");
    setEndAt("");
    loadBanners();
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
          placeholder="Título (ex: Promoção de fim de semana)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 sm:col-span-2"
        />
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Link da imagem do banner"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 sm:col-span-2"
        />
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
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={banner.image_url}
                alt={banner.title}
                className="h-20 w-full shrink-0 rounded-lg object-cover sm:w-32"
              />
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
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.style}`}>
                {status.text}
              </span>
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
          );
        })}
      </div>
    </div>
  );
}
