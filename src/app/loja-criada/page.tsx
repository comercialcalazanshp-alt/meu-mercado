"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LojaCriadaContent() {
  const params = useSearchParams();
  const slug = params.get("slug");

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-900 text-2xl font-bold text-amber-300 dark:bg-blue-800">
        🎉
      </div>
      <h1 className="mt-6 text-2xl font-bold text-slate-900 dark:text-slate-50">
        Loja criada!
      </h1>
      <p className="mt-3 max-w-md text-sm text-slate-600 dark:text-slate-400">
        {slug ? (
          <>
            Sua loja <strong className="text-slate-900 dark:text-slate-50">{slug}</strong> foi
            registrada com sucesso.
          </>
        ) : (
          "Sua loja foi registrada com sucesso."
        )}
      </p>
      <p className="mt-3 max-w-md text-sm text-slate-600 dark:text-slate-400">
        Enviamos um e-mail de confirmação — clique no link para ativar sua
        conta. Depois disso você já pode entrar e cadastrar seus produtos.
      </p>
      <a
        href="/entrar"
        className="mt-6 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-amber-300 dark:bg-blue-800"
      >
        Ir para o login
      </a>
    </div>
  );
}

export default function LojaCriada() {
  return (
    <Suspense>
      <LojaCriadaContent />
    </Suspense>
  );
}
