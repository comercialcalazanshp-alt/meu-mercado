import { getSupabase } from "@/lib/supabase";
import ConfirmacaoBanner from "./confirmacao-banner";

// Impede o Next.js de tentar buscar esse dado durante a publicação (build) —
// só busca quando alguém visita o site de verdade.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { count } = await getSupabase()
    .from("stores")
    .select("*", { count: "exact", head: true });

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <ConfirmacaoBanner />
      </div>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-900 text-2xl font-bold text-amber-300 dark:bg-blue-800">
        MM
      </div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
        Meu Mercado
      </h1>
      <p className="mt-3 max-w-md text-base text-slate-600 dark:text-slate-400">
        A plataforma que ajuda donos de mercadinho a vender online.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <a
          href="/cadastro"
          className="rounded-lg bg-blue-900 px-5 py-2.5 font-semibold text-amber-300 dark:bg-blue-800"
        >
          Criar minha loja
        </a>
        <a
          href="/entrar"
          className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
        >
          Já tenho loja — entrar
        </a>
      </div>

      {!!count && count > 0 && (
        <p className="mt-8 text-xs text-slate-400 dark:text-slate-600">
          {count} loja{count === 1 ? "" : "s"} já usando a plataforma
        </p>
      )}
    </div>
  );
}
