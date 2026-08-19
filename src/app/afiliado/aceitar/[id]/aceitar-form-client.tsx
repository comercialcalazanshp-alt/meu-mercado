"use client";

import { useState, type FormEvent } from "react";

export default function AceitarForm({ inviteId }: { inviteId: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/afiliados/aceitar-convite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_id: inviteId, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não deu pra criar sua conta.");
        return;
      }
      setDone(true);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        <p className="font-semibold">Prontinho!</p>
        <p className="mt-1">
          Sua loja já foi criada e ligada como afiliada. Agora é só entrar com o e-mail e senha que você acabou de
          criar.
        </p>
        <a
          href="/entrar"
          className="mt-3 inline-block rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300"
        >
          Entrar agora
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-700">Seu e-mail (vai ser seu login)</label>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="voce@email.com"
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <label className="mt-1 text-sm font-medium text-slate-700">Crie uma senha</label>
      <input
        type="password"
        required
        minLength={6}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="mínimo 6 caracteres"
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="mt-1 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-amber-300 disabled:opacity-60"
      >
        {saving ? "Criando sua conta…" : "Aceitar e criar minha loja"}
      </button>
    </form>
  );
}
