"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { StoreContext, type Store } from "@/lib/store-context";

const NAV_ITEMS = [
  { href: "/painel", label: "Início" },
  { href: "/painel/produtos", label: "Produtos" },
  { href: "/painel/pedidos", label: "Pedidos" },
];

export default function PainelLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [store, setStore] = useState<Store | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "sem-loja">("loading");

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/entrar");
        return;
      }

      const { data: storeRow } = await supabase
        .from("stores")
        .select("id, slug, name, whatsapp, active")
        .eq("owner_id", session.user.id)
        .maybeSingle();

      if (!active) return;

      if (!storeRow) {
        setStatus("sem-loja");
        return;
      }

      setStore(storeRow);
      setStatus("ready");
    }

    load();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.replace("/entrar");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignOut() {
    await getSupabase().auth.signOut();
    router.replace("/entrar");
  }

  if (status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando…</p>
      </div>
    );
  }

  if (status === "sem-loja") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center dark:bg-slate-950">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Não encontramos uma loja associada a essa conta.
        </p>
        <button
          onClick={handleSignOut}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 dark:bg-blue-800"
        >
          Sair
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-slate-50 dark:bg-slate-950 md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 md:w-56 md:border-b-0 md:border-r md:px-3 md:py-6">
        <div className="mb-4 px-2">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
            {store!.name}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">/{store!.slug}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive
                    ? "bg-blue-900 text-amber-300 dark:bg-blue-800"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        <button
          onClick={handleSignOut}
          className="mt-auto hidden rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:block"
        >
          Sair
        </button>
      </aside>
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
        <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
      </main>
    </div>
  );
}
