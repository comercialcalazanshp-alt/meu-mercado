"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Member = {
  id: string;
  email: string;
  created_at: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

export default function Equipe() {
  const store = useStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setIsOwner(!!session && session.user.id === store.owner_id);

    const { data } = await supabase
      .from("store_members")
      .select("id, email, created_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    setMembers((data ?? []) as Member[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Digite um e-mail válido.");
      return;
    }
    setSaving(true);
    const { error: insertError } = await getSupabase()
      .from("store_members")
      .insert({ store_id: store.id, email: trimmed });
    setSaving(false);
    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "Esse e-mail já está na equipe."
          : "Não deu pra adicionar: " + insertError.message,
      );
      return;
    }
    setEmail("");
    load();
  }

  async function handleRemove(id: string) {
    if (!confirm("Remover essa pessoa da equipe? Ela perde o acesso ao painel na hora.")) return;
    await getSupabase().from("store_members").delete().eq("id", id);
    load();
  }

  if (!loading && !isOwner) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Equipe</h1>
        <p className="mt-2 text-sm text-slate-500">
          Só o dono da loja pode ver e gerenciar quem tem acesso à equipe.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Equipe</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Convide gente de confiança pra ajudar a tocar a loja — quem entra na lista tem acesso completo
        ao painel (produtos, pedidos, PDV, caixa, fiado etc.), como se fosse você. Só você continua
        podendo gerenciar a equipe e excluir a conta.
      </p>

      <form
        onSubmit={handleInvite}
        className="mt-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row dark:border-slate-800 dark:bg-slate-900"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@exemplo.com"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
        <button
          type="submit"
          disabled={saving}
          className="shrink-0 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {saving ? "Adicionando…" : "Adicionar à equipe"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        A pessoa convidada cria a própria conta em{" "}
        <a href="/cadastro" className="underline">
          /cadastro
        </a>{" "}
        usando esse mesmo e-mail — o acesso à sua loja é liberado automaticamente, sem criar uma loja
        nova pra ela.
      </p>

      {loading && <p className="mt-6 text-sm text-slate-500">Carregando…</p>}
      {!loading && members.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">Ninguém convidado ainda — só você tem acesso.</p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-50">{m.email}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                adicionado em {formatDate(m.created_at)}
              </p>
            </div>
            <button
              onClick={() => handleRemove(m.id)}
              className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
            >
              Remover
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
