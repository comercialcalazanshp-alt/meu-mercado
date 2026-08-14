"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { getCustomerSupabase } from "@/lib/supabase-customer";
import { isValidCPF, formatCPF, onlyDigits } from "@/lib/cpf";

function CadastroClienteForm() {
  const params = useSearchParams();
  const loja = params.get("loja") ?? "";

  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidCPF(cpf)) {
      setError("Esse CPF não é válido. Confira os números.");
      return;
    }
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não são iguais.");
      return;
    }

    setLoading(true);
    const redirectTo = `${window.location.origin}/cliente/confirmado${loja ? `?loja=${loja}` : ""}`;
    const { error: authError } = await getCustomerSupabase().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          account_type: "customer",
          full_name: fullName.trim(),
          cpf: onlyDigits(cpf),
          birthdate,
        },
      },
    });
    setLoading(false);

    if (authError) {
      setError(
        authError.message.includes("already registered") ||
          authError.message.includes("já está cadastrado") ||
          authError.message.includes("Database error saving new user")
          ? "Já existe uma conta com esse e-mail ou CPF."
          : authError.message,
      );
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
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">Quase lá!</h1>
        <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">
          Mandamos um link de confirmação pro seu e-mail ({email}). Clique nele pra ativar sua conta.
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
          <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-50">Crie sua conta</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Grátis, e vale pra comprar em qualquer loja do Meu Mercado. Com conta você ganha cashback,
            usa a raspadinha e o programa de indicação.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Nome completo
            </label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              placeholder="Seu nome completo"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">CPF</label>
            <input
              required
              inputMode="numeric"
              value={cpf}
              onChange={(e) => setCpf(formatCPF(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              placeholder="000.000.000-00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Data de nascimento
            </label>
            <input
              required
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
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
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              placeholder="Pelo menos 8 caracteres"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Confirme a senha
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
            className="w-full rounded-lg bg-blue-900 px-4 py-2.5 font-semibold text-amber-300 transition-opacity disabled:opacity-60 dark:bg-blue-800"
          >
            {loading ? "Criando…" : "Criar minha conta"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">
          Já tem conta?{" "}
          <a
            href={`/cliente/entrar${loja ? `?loja=${loja}` : ""}`}
            className="font-medium text-blue-900 underline dark:text-blue-400"
          >
            Entrar
          </a>
        </p>
      </div>
    </div>
  );
}

export default function CadastroCliente() {
  return (
    <Suspense fallback={null}>
      <CadastroClienteForm />
    </Suspense>
  );
}
