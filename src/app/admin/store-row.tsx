"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleStoreActive } from "./actions";

type Store = {
  id: string;
  slug: string;
  name: string;
  whatsapp: string | null;
  active: boolean;
  created_at: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

export default function StoreRow({
  store,
  productCount,
  orderCount,
}: {
  store: Store;
  productCount: number;
  orderCount: number;
}) {
  const router = useRouter();
  const [active, setActive] = useState(store.active);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !active;
    setActive(next);
    startTransition(async () => {
      await toggleStoreActive(store.id, next);
      router.refresh();
    });
  }

  return (
    <tr>
      <td className="px-3 py-2">
        <a
          href={`/loja/${store.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-blue-900 underline dark:text-blue-400"
        >
          {store.name}
        </a>
        <p className="text-xs text-slate-400 dark:text-slate-500">/{store.slug}</p>
      </td>
      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{store.whatsapp || "—"}</td>
      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
        {formatDate(store.created_at)}
      </td>
      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{productCount}</td>
      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{orderCount}</td>
      <td className="px-3 py-2">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            active
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
              : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          }`}
        >
          {active ? "Ativa" : "Desativada"}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={handleToggle}
          disabled={isPending}
          className="text-xs font-medium text-slate-500 hover:underline disabled:opacity-50 dark:text-slate-400"
        >
          {active ? "Desativar" : "Ativar"}
        </button>
      </td>
    </tr>
  );
}
