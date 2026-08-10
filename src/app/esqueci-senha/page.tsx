"use client";

import { useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";

export default function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    const { error: resetError } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-900 text-2xl font-bold text-amber-300 dark:bg-blue-800">
          ✓
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">E-mail enviado</h1>
        <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">
          Se {email} tiver uma loja cadastrada, chega um link pra redefinir a senha em instantes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-6 py-16 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-900 text-lg font-bold text-amber-300 dark:bg-blue-800">
            MM
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-50">
            Esqueceu sua senha?
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Digite seu e-mail e mandamos um link pra você criar uma nova.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-900 px-4 py-2.5 font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {loading ? "Enviando…" : "Enviar link de redefinição"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
          <a href="/entrar" className="font-medium text-blue-900 underline dark:text-blue-400">
            Voltar pro login
          </a>
        </p>
      </div>
    </div>
  );
}
