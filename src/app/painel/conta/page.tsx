"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { deleteMyAccount } from "./actions";

export default function MinhaConta() {
  const store = useStore();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(store.name);
  const [whatsapp, setWhatsapp] = useState(store.whatsapp ?? "");
  const [savingStore, setSavingStore] = useState(false);
  const [storeSaved, setStoreSaved] = useState(false);

  const canDelete = confirmText.trim() === store.slug;

  async function handleSaveStore(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingStore(true);
    setStoreSaved(false);
    const { error: updateError } = await getSupabase()
      .from("stores")
      .update({ name: name.trim(), whatsapp: whatsapp.trim() || null })
      .eq("id", store.id);
    setSavingStore(false);
    if (!updateError) {
      setStoreSaved(true);
      setTimeout(() => window.location.reload(), 600);
    }
  }

  async function handleDelete() {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError(null);

    const {
      data: { session },
    } = await getSupabase().auth.getSession();

    if (!session) {
      setError("Sua sessão expirou. Recarregue a página e entre de novo.");
      setDeleting(false);
      return;
    }

    const result = await deleteMyAccount(session.access_token);

    if (result.error) {
      setError(result.error);
      setDeleting(false);
      return;
    }

    await getSupabase().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Minha conta</h1>

      <form
        onSubmit={handleSaveStore}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Dados da loja
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">/{store.slug}</p>
        <div className="mt-3 space-y-2">
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Nome da loja</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">WhatsApp da loja</label>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(11) 91234-5678"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={savingStore || !name.trim()}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingStore ? "Salvando…" : "Salvar"}
          </button>
          {storeSaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
      </form>

      <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
        <h2 className="font-semibold text-red-700 dark:text-red-400">Excluir minha conta e loja</h2>
        <p className="mt-1 text-sm text-red-700/80 dark:text-red-400/80">
          Isso apaga sua conta, sua loja, todos os produtos, pedidos, cupons, banners, kits e o
          histórico de fiado. Não tem como desfazer.
        </p>
        <label className="mt-3 block text-sm font-medium text-red-700 dark:text-red-400">
          Digite <span className="font-mono">{store.slug}</span> pra confirmar
        </label>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mt-1 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-red-900/50 dark:bg-slate-900 dark:text-slate-50"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={handleDelete}
          disabled={!canDelete || deleting}
          className="mt-3 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {deleting ? "Excluindo…" : "Excluir minha conta permanentemente"}
        </button>
      </div>
    </div>
  );
}
