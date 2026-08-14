"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export function resizeImage(file: File, maxSize = 800): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Sem contexto de canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar imagem"))), "image/jpeg", 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não deu pra abrir a imagem"));
    };
    img.src = url;
  });
}

export async function uploadStoreImage(file: File, storeId: string, prefix: string): Promise<string> {
  const blob = await resizeImage(file);
  const path = `${storeId}/${prefix}-${crypto.randomUUID()}.jpg`;
  const { error } = await getSupabase().storage.from("product-images").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  const { data } = getSupabase().storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

type CatalogProduct = { id: string; name: string; image_url: string | null };

// Campo de foto reutilizável: tirar foto / escolher da galeria, colar link,
// ou gerar com IA (texto editável + fotos de referência, do catálogo ou
// tiradas na hora). Usado em Kits, Receitas e Banners.
type RecentImage = { url: string; name: string };

export default function PhotoField({
  storeId,
  value,
  onChange,
  uploadPrefix,
  promptSeed,
  catalogProducts = [],
  imageSize = "1024x1024",
}: {
  storeId: string;
  value: string;
  onChange: (url: string) => void;
  uploadPrefix: string;
  promptSeed: string;
  catalogProducts?: CatalogProduct[];
  imageSize?: "1024x1024" | "1536x1024" | "1024x1536";
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<Set<string>>(new Set());
  const [extraRefs, setExtraRefs] = useState<string[]>([]);
  const [uploadingExtraRef, setUploadingExtraRef] = useState(false);
  const [generating, setGenerating] = useState(false);
  const extraRefInputRef = useRef<HTMLInputElement>(null);

  const [recentOpen, setRecentOpen] = useState(false);
  const [recentImages, setRecentImages] = useState<RecentImage[] | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    if (!recentOpen || recentImages !== null) return;
    setLoadingRecent(true);
    getSupabase()
      .storage.from("product-images")
      .list(storeId, { limit: 30, sortBy: { column: "created_at", order: "desc" } })
      .then(({ data }) => {
        const files = (data ?? []).filter((f) => f.id);
        setRecentImages(
          files.map((f) => ({
            name: f.name,
            url: getSupabase().storage.from("product-images").getPublicUrl(`${storeId}/${f.name}`).data.publicUrl,
          })),
        );
        setLoadingRecent(false);
      });
  }, [recentOpen, recentImages, storeId]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadStoreImage(file, storeId, uploadPrefix);
      onChange(url);
      setRecentImages(null);
    } catch (err) {
      setError("Não deu pra enviar a foto: " + (err instanceof Error ? err.message : ""));
    } finally {
      setUploading(false);
    }
  }

  function openAiPanel() {
    if (!promptSeed.trim()) {
      setError("Preencha os dados principais primeiro pra gerar a imagem.");
      return;
    }
    setError(null);
    setPrompt(promptSeed);
    setRefs(new Set());
    setExtraRefs([]);
    setAiOpen(true);
  }

  async function handleAddExtraRefPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingExtraRef(true);
    try {
      const url = await uploadStoreImage(file, storeId, uploadPrefix);
      setExtraRefs((prev) => [...prev, url]);
    } catch {
      // sem sorte com essa foto — dá pra tentar de novo
    } finally {
      setUploadingExtraRef(false);
    }
  }

  async function submitAi() {
    if (!prompt.trim()) return;
    const refUrls = [
      ...catalogProducts.filter((p) => refs.has(p.id) && p.image_url).map((p) => p.image_url as string),
      ...extraRefs,
    ];
    setGenerating(true);
    setError(null);
    const { data: sessionData } = await getSupabase().auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setError("Sessão expirada, atualize a página.");
      setGenerating(false);
      return;
    }
    const res = await fetch("/api/ai-image", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        store_id: storeId,
        prompt,
        reference_image_urls: refUrls,
        prefix: uploadPrefix,
        size: imageSize,
      }),
    });
    const data = await res.json();
    setGenerating(false);
    if (!res.ok) {
      setError(data.error || "Não deu pra gerar a imagem por IA");
      return;
    }
    onChange(data.image_url as string);
    setAiOpen(false);
    setRecentImages(null);
  }

  const withPhoto = catalogProducts.filter((p) => p.image_url);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
        >
          {uploading ? "Enviando…" : "📷 Tirar foto / Escolher da galeria"}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
        <button
          type="button"
          onClick={openAiPanel}
          className="rounded-lg border border-purple-300 px-3 py-2 text-sm font-medium text-purple-700 dark:border-purple-800 dark:text-purple-300"
        >
          ✨ Gerar imagem com IA
        </button>
        {value && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-10 w-10 rounded-lg object-cover" />
        )}
      </div>
      <input
        key={`photo-link-${value}`}
        defaultValue={value}
        onBlur={(e) => onChange(e.target.value.trim())}
        placeholder="Ou cole o link de uma imagem"
        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      <button
        type="button"
        onClick={() => setRecentOpen((v) => !v)}
        className="mt-2 text-xs font-medium text-slate-500 underline dark:text-slate-400"
      >
        {recentOpen ? "Esconder imagens recentes" : "🖼️ Reaproveitar imagem que já usei"}
      </button>
      {recentOpen && (
        <div className="mt-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
          {loadingRecent && <p className="text-xs text-slate-500">Carregando…</p>}
          {!loadingRecent && recentImages?.length === 0 && (
            <p className="text-xs text-slate-500">Nenhuma imagem salva ainda.</p>
          )}
          <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            {recentImages?.map((img) => (
              <button
                key={img.url}
                type="button"
                onClick={() => onChange(img.url)}
                className={`overflow-hidden rounded-lg border-2 ${
                  value === img.url ? "border-purple-500" : "border-transparent"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-14 w-14 object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 dark:bg-slate-900">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">✨ Gerar imagem com IA</p>
            <label className="mt-3 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Descreva a imagem — pode escrever do seu jeito
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />

            <div className="mt-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Tirar foto ou escolher da galeria pra usar como referência (opcional)
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-lg border border-purple-300 px-3 py-1.5 text-xs font-medium text-purple-700 dark:border-purple-800 dark:text-purple-300">
                  {uploadingExtraRef ? "Enviando…" : "📷 Adicionar foto"}
                  <input
                    ref={extraRefInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleAddExtraRefPhoto}
                    disabled={uploadingExtraRef}
                    className="hidden"
                  />
                </label>
                {extraRefs.map((url, i) => (
                  <div key={url} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-10 w-10 rounded-lg border border-purple-300 object-cover" />
                    <button
                      type="button"
                      onClick={() => setExtraRefs((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {withPhoto.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Usar fotos de produtos do seu catálogo como referência (opcional) — a IA edita/combina essas fotos de
                  verdade, em vez de só imaginar a partir do texto
                </p>
                <div className="mt-1 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                  {withPhoto.map((p) => {
                    const checked = refs.has(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                          checked ? "border-purple-400 bg-purple-50 dark:bg-purple-900/20" : "border-slate-300 dark:border-slate-700"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(refs);
                            if (e.target.checked) next.add(p.id);
                            else next.delete(p.id);
                            setRefs(next);
                          }}
                        />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.image_url as string} alt="" className="h-6 w-6 rounded object-cover" />
                        {p.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitAi}
                disabled={generating}
                className="rounded-lg bg-purple-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {generating ? "Gerando…" : "Gerar imagem"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
