"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { slugify } from "@/lib/slugify";

export default function Cadastro() {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabase();

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError || !authData.user) {
      setError(authError?.message ?? "Não foi possível criar a conta.");
      setLoading(false);
      return;
    }

    const baseSlug = slugify(storeName);
    let slug = baseSlug;
    let { error: storeError } = await supabase.from("stores").insert({
      owner_id: authData.user.id,
      slug,
      name: storeName,
    });

    if (storeError?.code === "23505") {
      slug = `${baseSlug}-${Math.floor(Math.random() * 10000)}`;
      ({ error: storeError } = await supabase.from("stores").insert({
        owner_id: authData.user.id,
        slug,
        name: storeName,
      }));
    }

    if (storeError) {
      setError(
        "Sua conta foi criada, mas não deu pra registrar a loja: " +
          storeError.message,
      );
      setLoading(false);
      return;
    }

    router.push(`/loja-criada?slug=${slug}`);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-6 py-16 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-900 text-lg font-bold text-amber-300 dark:bg-blue-800">
            MM
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-50">
            Crie sua loja
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Comece a vender online em poucos minutos.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Nome da loja
            </label>
            <input
              required
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              placeholder="Mercadinho do João"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Seu e-mail
            </label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              placeholder="voce@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Senha
            </label>
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              placeholder="Pelo menos 8 caracteres"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-900 px-4 py-2.5 font-semibold text-amber-300 transition-opacity disabled:opacity-60 dark:bg-blue-800"
          >
            {loading ? "Criando…" : "Criar minha loja"}
          </button>
        </form>
      </div>
    </div>
  );
}
