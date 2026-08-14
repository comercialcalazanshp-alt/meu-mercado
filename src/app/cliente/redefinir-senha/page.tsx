"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { getCustomerSupabase } from "@/lib/supabase-customer";
import { clearCustomerLockout } from "@/app/cliente/actions";

function RedefinirSenhaClienteForm() {
  const params = useSearchParams();
  const loja = params.get("loja") ?? "";
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = getCustomerSupabase();

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (password !== confirmPassword) {
      setError("As senhas não são iguais.");
      return;
    }

    setLoading(true);
    const supabase = getCustomerSupabase();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await clearCustomerLockout(data.session.access_token);
    }

    setLoading(false);
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-900 text-2xl font-bold text-amber-300 dark:bg-blue-800">
          ✓
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">Senha atualizada!</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Sua conta está livre de qualquer bloqueio anterior.
        </p>
        <a
          href={loja ? `/loja/${loja}` : "/"}
          className="mt-2 rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-semibold text-amber-300 dark:bg-blue-800"
        >
          {loja ? "Voltar pra loja" : "Ir pro Meu Mercado"}
        </a>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
        <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">
          Esse link de redefinição de senha é inválido ou já expirou.
        </p>
        <a
          href={`/cliente/esqueci-senha${loja ? `?loja=${loja}` : ""}`}
          className="font-medium text-blue-900 underline dark:text-blue-400"
        >
          Pedir um novo link
        </a>
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
          <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-50">Crie uma nova senha</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Nova senha
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
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Confirme a nova senha
            </label>
            <input
              required
              type="password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              placeholder="Repita a senha"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-900 px-4 py-2.5 font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {loading ? "Salvando…" : "Salvar nova senha"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function RedefinirSenhaCliente() {
  return (
    <Suspense fallback={null}>
      <RedefinirSenhaClienteForm />
    </Suspense>
  );
}
