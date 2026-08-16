"use client";

import { useState, type FormEvent } from "react";

export default function AceitarForm({
  id,
  fullName,
  jaConfirmado,
}: {
  id: string;
  fullName: string;
  jaConfirmado: boolean;
}) {
  const [confirmacao, setConfirmacao] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(jaConfirmado);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/equipe/aceitar-entregador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, confirmacao }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não deu pra confirmar.");
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
        <p className="font-semibold">Prontinho, {fullName}!</p>
        <p className="mt-1">
          Confirmação registrada. Agora é só aguardar o responsável da loja te passar o login e a senha de
          acesso.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-700">
        Digite <b>SIM</b> pra confirmar que leu e concorda:
      </label>
      <input
        type="text"
        value={confirmacao}
        onChange={(e) => setConfirmacao(e.target.value)}
        placeholder="SIM"
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="mt-1 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-amber-300 disabled:opacity-60"
      >
        {saving ? "Confirmando…" : "Confirmar"}
      </button>
    </form>
  );
}
