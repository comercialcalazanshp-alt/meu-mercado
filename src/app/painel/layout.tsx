"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { StoreContext, type Store } from "@/lib/store-context";

type OrderNotification = {
  id: string;
  customerName: string;
  total: number;
};

const SOUND_MUTED_KEY = "mm_order_sound_muted";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function playNewOrderChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    [880, 1108].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  } catch {
    // navegador sem suporte a Web Audio — só perde o som, o toast continua aparecendo
  }
}

const NAV_ITEMS = [
  { href: "/painel", label: "Início" },
  { href: "/painel/pdv", label: "PDV" },
  { href: "/painel/caixa", label: "Caixa" },
  { href: "/painel/produtos", label: "Produtos" },
  { href: "/painel/kits", label: "Kits" },
  { href: "/painel/assinaturas", label: "Assinaturas" },
  { href: "/painel/receitas", label: "Receitas" },
  { href: "/painel/banners", label: "Banners" },
  { href: "/painel/ofertas", label: "Ofertas" },
  { href: "/painel/raspadinha", label: "Raspadinha" },
  { href: "/painel/cupons", label: "Cupons" },
  { href: "/painel/bairros", label: "Frete" },
  { href: "/painel/fiado", label: "Fiado" },
  { href: "/painel/despesas", label: "Despesas" },
  { href: "/painel/cashback", label: "Cashback" },
  { href: "/painel/mensagens", label: "Mensagens" },
  { href: "/painel/campanhas", label: "Campanhas" },
  { href: "/painel/pedidos", label: "Pedidos" },
  { href: "/painel/relatorios", label: "Relatórios" },
  { href: "/painel/avaliacoes", label: "Avaliações" },
  { href: "/painel/trafego", label: "Tráfego" },
  { href: "/painel/cartaz", label: "Cartaz" },
  { href: "/painel/catalogo", label: "Catálogo PDF" },
  { href: "/painel/ajuda", label: "Ajuda" },
  { href: "/painel/conta", label: "Minha conta" },
];

export default function PainelLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [store, setStore] = useState<Store | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "sem-loja">("loading");
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);
  const [soundMuted, setSoundMuted] = useState(false);

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

  useEffect(() => {
    setSoundMuted(localStorage.getItem(SOUND_MUTED_KEY) === "1");
  }, []);

  useEffect(() => {
    if (!store) return;
    const supabase = getSupabase();

    const channel = supabase
      .channel(`orders-realtime-${store.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `store_id=eq.${store.id}` },
        (payload) => {
          const order = payload.new as { id: string; customer_name: string; total: number };
          setNotifications((prev) => [
            { id: order.id, customerName: order.customer_name, total: order.total },
            ...prev,
          ]);
          if (localStorage.getItem(SOUND_MUTED_KEY) !== "1") playNewOrderChime();
          setTimeout(() => {
            setNotifications((prev) => prev.filter((n) => n.id !== order.id));
          }, 10000);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [store]);

  function toggleSound() {
    const next = !soundMuted;
    setSoundMuted(next);
    localStorage.setItem(SOUND_MUTED_KEY, next ? "1" : "0");
  }

  function dismissNotification(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

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
        <div className="mb-4 flex items-start justify-between gap-2 px-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
              {store!.name}
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">/{store!.slug}</p>
          </div>
          <button
            onClick={toggleSound}
            title={soundMuted ? "Ativar som de pedido novo" : "Silenciar som de pedido novo"}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            {soundMuted ? "🔕" : "🔔"}
          </button>
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

      {notifications.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
          {notifications.map((n) => (
            <a
              key={n.id}
              href="/painel/pedidos"
              className="flex items-start justify-between gap-2 rounded-xl border border-blue-900 bg-white p-3 shadow-lg dark:border-blue-700 dark:bg-slate-900"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  🛎️ Novo pedido!
                </p>
                <p className="truncate text-sm text-slate-600 dark:text-slate-400">
                  {n.customerName} · {formatCurrency(n.total)}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  dismissNotification(n.id);
                }}
                className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                ✕
              </button>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
