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

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
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

const CAIXA_ALLOWED_PATHS = new Set(["/painel/pdv", "/painel/caixa"]);
const ENTREGADOR_ALLOWED_PATHS = new Set(["/painel/entregas"]);

const NAV_ITEMS = [
  { href: "/painel", label: "Início" },
  { href: "/painel/dashboard", label: "Dashboard" },
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
  { href: "/painel/clientes", label: "Clientes" },
  { href: "/painel/fiado", label: "Fiado" },
  { href: "/painel/despesas", label: "Despesas" },
  { href: "/painel/cashback", label: "Cashback" },
  { href: "/painel/mensagens", label: "Mensagens" },
  { href: "/painel/campanhas", label: "Campanhas" },
  { href: "/painel/pedidos", label: "Pedidos" },
  { href: "/painel/entregas", label: "Entregas" },
  { href: "/painel/afiliados", label: "Afiliados" },
  { href: "/painel/relatorios", label: "Relatórios" },
  { href: "/painel/avaliacoes", label: "Avaliações" },
  { href: "/painel/reclamacoes", label: "Reclamações" },
  { href: "/painel/trafego", label: "Tráfego" },
  { href: "/painel/cartaz", label: "Cartaz" },
  { href: "/painel/catalogo", label: "Catálogo PDF" },
  { href: "/painel/ajuda", label: "Ajuda" },
  { href: "/painel/equipe", label: "Equipe" },
  { href: "/painel/configuracoes", label: "⚙️ Configurações" },
];

export default function PainelLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [store, setStore] = useState<Store | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "sem-loja">("loading");
  const [role, setRole] = useState<"completo" | "caixa" | "entregador">("completo");
  // Toda loja pode virar um Hub (ligar afiliados) — mas só faz sentido
  // mostrar o item "Afiliados" no menu depois que a loja de fato configurou
  // isso (existe uma linha em affiliate_settings). Sem essa checagem, o
  // menu de uma loja comum (ou de um afiliado, que também é só "uma loja")
  // mostraria um item de gestão que não significa nada pra ela.
  const [isHub, setIsHub] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);
  const [soundMuted, setSoundMuted] = useState(false);
  const [pushStatus, setPushStatus] = useState<"unsupported" | "off" | "on" | "denied">("off");
  const [pushLoading, setPushLoading] = useState(false);
  const [unseenOrders, setUnseenOrders] = useState(0);

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

      const { data: storeRows } = await supabase.rpc("get_my_store");
      const storeRow = storeRows?.[0] ?? null;

      if (!active) return;

      if (!storeRow) {
        setStatus("sem-loja");
        return;
      }

      setStore(storeRow);
      setStatus("ready");

      const { data: hubRow } = await supabase
        .from("affiliate_settings")
        .select("id")
        .eq("hub_store_id", storeRow.id)
        .maybeSingle();
      if (active) setIsHub(!!hubRow);

      const { data: roleData } = await supabase.rpc("get_my_role", { p_store_id: storeRow.id });
      if (active && (roleData === "caixa" || roleData === "entregador")) setRole(roleData);

      // Só o entregador precisa marcar a inscrição de push com o próprio
      // member_id — pra loja receber alerta de gestão (estoque, pedido
      // parado) só o dono, e entrega demorando os dois. Sem isso a
      // inscrição de push do entregador ficaria indistinguível da do dono.
      if (active && roleData === "entregador") {
        const { data: memberRow } = await supabase
          .from("store_members")
          .select("id")
          .eq("store_id", storeRow.id)
          .maybeSingle();
        if (active && memberRow) setMemberId(memberRow.id);
      }
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
    if (status !== "ready") return;
    if (role === "caixa" && !CAIXA_ALLOWED_PATHS.has(pathname)) {
      router.replace("/painel/pdv");
    } else if (role === "entregador" && !ENTREGADOR_ALLOWED_PATHS.has(pathname)) {
      router.replace("/painel/entregas");
    }
  }, [status, role, pathname, router]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushStatus("denied");
      return;
    }
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setPushStatus(sub ? "on" : "off");
    });
  }, []);

  async function handleEnablePush() {
    if (!store) return;
    setPushLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setPushStatus("off");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON();
      await getSupabase().from("push_subscriptions").upsert(
        {
          store_id: store.id,
          member_id: memberId,
          endpoint: json.endpoint!,
          p256dh: json.keys!.p256dh,
          auth: json.keys!.auth,
        },
        { onConflict: "endpoint" },
      );
      setPushStatus("on");
    } finally {
      setPushLoading(false);
    }
  }

  useEffect(() => {
    if (!store) return;
    const supabase = getSupabase();

    async function refreshUnseenCount() {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("store_id", store!.id)
        .is("seen_at", null);
      setUnseenOrders(count ?? 0);
    }

    refreshUnseenCount();

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
          refreshUnseenCount();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `store_id=eq.${store.id}` },
        () => refreshUnseenCount(),
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

  const isPdv = pathname === "/painel/pdv";

  if (isPdv) {
    return (
      <div className="flex flex-1 flex-col bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
          <a
            href={role === "caixa" ? "/painel/caixa" : "/painel"}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            {role === "caixa" ? "Abrir/fechar caixa" : "← Voltar ao painel"}
          </a>
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{store!.name}</p>
        </div>
        <main className="flex-1 px-4 py-4 md:px-6 md:py-6">
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
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">🛎️ Novo pedido!</p>
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

  const isEntregas = pathname === "/painel/entregas";

  if (isEntregas) {
    return (
      <div className="flex flex-1 flex-col bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{store!.name}</p>
          <div className="flex items-center gap-1">
            {pushStatus === "off" && (
              <button
                onClick={handleEnablePush}
                disabled={pushLoading}
                title="Ativar notificação de entrega demorando mesmo com o painel fechado"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                📲
              </button>
            )}
            {pushStatus === "on" && (
              <span title="Notificação ativada nesse aparelho" className="rounded-lg p-1.5 text-emerald-500">
                ✅
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Sair
            </button>
          </div>
        </div>
        <main className="flex-1 px-4 py-4 md:px-6 md:py-6">
          <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
        </main>
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
          <div className="flex shrink-0 items-center gap-1">
            {pushStatus === "off" && (
              <button
                onClick={handleEnablePush}
                disabled={pushLoading}
                title="Ativar notificação de pedido novo mesmo com o painel fechado"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                📲
              </button>
            )}
            {pushStatus === "on" && (
              <span
                title="Notificação de pedido novo ativada nesse aparelho"
                className="rounded-lg p-1.5 text-emerald-500"
              >
                ✅
              </span>
            )}
            {pushStatus === "denied" && (
              <span
                title="Notificação bloqueada nas configurações do navegador — precisa liberar lá pra ativar"
                className="rounded-lg p-1.5 text-slate-300 dark:text-slate-600"
              >
                🔕
              </span>
            )}
            <button
              onClick={toggleSound}
              title={soundMuted ? "Ativar som de pedido novo" : "Silenciar som de pedido novo"}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              {soundMuted ? "🔕" : "🔔"}
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {(role === "caixa"
            ? NAV_ITEMS.filter((item) => CAIXA_ALLOWED_PATHS.has(item.href))
            : role === "entregador"
              ? NAV_ITEMS.filter((item) => ENTREGADOR_ALLOWED_PATHS.has(item.href))
              : isHub
                ? NAV_ITEMS
                : NAV_ITEMS.filter((item) => item.href !== "/painel/afiliados")
          ).map((item) => {
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
                {item.href === "/painel/pedidos" && unseenOrders > 0 && (
                  <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {unseenOrders}
                  </span>
                )}
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
