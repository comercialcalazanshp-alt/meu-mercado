"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSupportRequestStatus } from "./actions";

export type SupportRequest = {
  id: string;
  message: string;
  status: "aberto" | "respondido";
  created_at: string;
  store: { name: string; slug: string; whatsapp: string | null } | null;
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function SupportRequestRow({ request }: { request: SupportRequest }) {
  const router = useRouter();
  const [status, setStatus] = useState(request.status);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = status === "aberto" ? "respondido" : "aberto";
    setStatus(next);
    startTransition(async () => {
      await updateSupportRequestStatus(request.id, next);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900 dark:text-slate-50">
            {request.store?.name ?? "(loja removida)"}
            {request.store?.whatsapp && (
              <span className="ml-2 text-xs font-normal text-slate-400">{request.store.whatsapp}</span>
            )}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{formatDateTime(request.created_at)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            status === "aberto"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400"
              : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
          }`}
        >
          {status === "aberto" ? "Aberto" : "Respondido"}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{request.message}</p>
      <button
        onClick={handleToggle}
        disabled={isPending}
        className="mt-2 text-xs font-medium text-blue-900 hover:underline disabled:opacity-50 dark:text-blue-400"
      >
        {status === "aberto" ? "Marcar como respondido" : "Reabrir"}
      </button>
    </div>
  );
}
