"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { User, Lock } from "lucide-react";

export default function Entrar() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await getSupabase().auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(
        authError.message === "Email not confirmed"
          ? "Você ainda não confirmou seu e-mail. Cheque sua caixa de entrada."
          : "E-mail ou senha incorretos.",
      );
      setLoading(false);
      return;
    }

    router.push("/painel");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-[#0A0A0C] px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-44 h-[420px] w-[420px] rounded-full opacity-50 blur-[70px]"
        style={{ background: "radial-gradient(circle at 35% 35%, #E8683B, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-32 h-[400px] w-[400px] rounded-full opacity-50 blur-[70px]"
        style={{ background: "radial-gradient(circle at 65% 65%, #9B4FD1, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-16 h-[280px] w-[280px] rounded-full opacity-30 blur-[70px]"
        style={{ background: "radial-gradient(circle, #D14F8C, transparent 65%)" }}
      />

      <div className="relative w-full max-w-sm rounded-[40px] border border-white/[0.14] bg-white/[0.055] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-10">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#F0BB5E] text-[11px] font-extrabold text-[#241705]">
            MM
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/60">Dono</span>
        </div>

        <h1 className="mb-6 text-2xl font-extrabold tracking-wide text-[#F5F3EF]">Entrar</h1>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-2.5 rounded-full border border-teal-300/25 bg-teal-900/20 px-4 py-3">
            <User size={16} aria-hidden className="shrink-0 text-white/70" />
            <input
              required
              type="email"
              aria-label="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-mail"
              className="w-full bg-transparent text-sm text-[#F5F3EF] outline-none placeholder:text-white/35"
            />
          </div>
          <div className="flex items-center gap-2.5 rounded-full border border-teal-300/25 bg-teal-900/20 px-4 py-3">
            <Lock size={16} aria-hidden className="shrink-0 text-white/70" />
            <input
              required
              type="password"
              aria-label="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha"
              className="w-full bg-transparent text-sm text-[#F5F3EF] outline-none placeholder:text-white/35"
            />
          </div>

          {error && <p className="px-1 text-sm font-medium text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-full bg-[#F0BB5E] py-3 text-[13px] font-extrabold uppercase tracking-[0.06em] text-[#241705] transition-opacity disabled:opacity-60"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-[12.5px] text-white/40">
          <a href="/esqueci-senha" className="text-white/60 underline underline-offset-2 hover:text-white/80">
            Esqueci minha senha
          </a>
        </p>
      </div>
    </div>
  );
}
