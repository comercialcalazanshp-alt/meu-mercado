"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCustomerSupabase } from "@/lib/supabase-customer";

function EntrarClienteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const loja = params.get("loja") ?? "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLocked(false);
    setLoading(true);

    // Login passa por uma rota do servidor (não signInWithPassword direto)
    // porque o bloqueio depois de 3 senhas erradas precisa ser real (bane a
    // conta de verdade via Admin API), não só um contador que a tela mostra.
    const res = await fetch("/api/cliente/entrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Não foi possível entrar.");
      setLocked(!!data.locked);
      setLoading(false);
      return;
    }

    await getCustomerSupabase().auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });

    setLoading(false);
    router.push(loja ? `/loja/${loja}` : "/");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-6 py-16 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-900 text-lg font-bold text-amber-300 dark:bg-blue-800">
            MM
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-50">Entrar na sua conta</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Sua conta de cliente vale em qualquer loja do Meu Mercado.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">E-mail</label>
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
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Senha</label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              placeholder="Sua senha"
            />
          </div>

          {error && (
            <p className={`text-sm ${locked ? "text-amber-700 dark:text-amber-400" : "text-red-600"}`}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-900 px-4 py-2.5 font-semibold text-amber-300 transition-opacity disabled:opacity-60 dark:bg-blue-800"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm">
          <a
            href={`/cliente/esqueci-senha${loja ? `?loja=${loja}` : ""}`}
            className="text-slate-500 underline dark:text-slate-400"
          >
            Esqueci minha senha
          </a>
        </p>

        <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-400">
          Ainda não tem conta?{" "}
          <a
            href={`/cliente/cadastro${loja ? `?loja=${loja}` : ""}`}
            className="font-medium text-blue-900 underline dark:text-blue-400"
          >
            Criar conta grátis
          </a>
        </p>
      </div>
    </div>
  );
}

export default function EntrarCliente() {
  return (
    <Suspense fallback={null}>
      <EntrarClienteForm />
    </Suspense>
  );
}
