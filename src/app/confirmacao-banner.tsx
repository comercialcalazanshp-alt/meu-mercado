"use client";

import { useEffect, useState } from "react";

export default function ConfirmacaoBanner() {
  const [confirmado, setConfirmado] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    const search = window.location.search;
    const isConfirmation =
      hash.includes("type=signup") ||
      hash.includes("type=email_change") ||
      search.includes("type=signup") ||
      search.includes("type=email_change");

    if (isConfirmation) {
      setConfirmado(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (!confirmado) return null;

  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-left dark:border-green-900 dark:bg-green-900/30">
      <span className="text-xl">✓</span>
      <div>
        <p className="font-semibold text-green-800 dark:text-green-300">E-mail confirmado!</p>
        <p className="text-sm text-green-700 dark:text-green-400">
          Sua conta já está ativa —{" "}
          <a href="/entrar" className="font-medium underline">
            clique aqui pra entrar
          </a>
          .
        </p>
      </div>
    </div>
  );
}
