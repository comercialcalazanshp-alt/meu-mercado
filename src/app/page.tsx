import { getSupabase } from "@/lib/supabase";

// Impede o Next.js de tentar buscar esse dado durante a publicação (build) —
// só busca quando alguém visita o site de verdade.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { count, error } = await getSupabase()
    .from("stores")
    .select("*", { count: "exact", head: true });

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-900 text-2xl font-bold text-amber-300 dark:bg-blue-800">
        MM
      </div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
        Meu Mercado
      </h1>
      <p className="mt-3 max-w-md text-base text-slate-600 dark:text-slate-400">
        A plataforma que ajuda donos de mercadinho a vender online — em
        construção.
      </p>
      <p className="mt-6 text-xs text-slate-400 dark:text-slate-600">
        {error
          ? `Banco de dados: erro ao conectar (${error.message})`
          : `Banco de dados conectado — ${count ?? 0} loja(s) cadastrada(s)`}
      </p>
    </div>
  );
}
