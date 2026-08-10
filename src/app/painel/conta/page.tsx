"use client";

import { useState } from "react";
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

  const canDelete = confirmText.trim() === store.slug;

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

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-600 dark:text-slate-400">Loja</p>
        <p className="font-medium text-slate-900 dark:text-slate-50">
          {store.name} (/{store.slug})
        </p>
      </div>

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
