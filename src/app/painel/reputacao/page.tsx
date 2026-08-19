"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type StoreReputation = {
  store_id: string;
  store_name: string;
  avg_rating: number | null;
  review_count: number;
  complaint_count: number;
  complaint_open_count: number;
};

type ComplaintDetail = {
  id: string;
  store_id: string;
  store_name: string;
  category: string;
  description: string;
  status: string;
  created_at: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  produto_errado: "Produto errado",
  produto_danificado: "Produto danificado",
  faltou_item: "Faltou item",
  atraso_entrega: "Atraso na entrega",
  cobranca_errada: "Cobrança errada",
  atendimento: "Atendimento",
  outro: "Outro",
};

const STATUS_LABEL: Record<string, { text: string; style: string }> = {
  aberta: { text: "Aberta", style: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" },
  em_andamento: { text: "Em andamento", style: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  resolvida: { text: "Resolvida", style: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

export default function Reputacao() {
  const store = useStore();
  const [reputation, setReputation] = useState<StoreReputation[]>([]);
  const [complaints, setComplaints] = useState<ComplaintDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const [repRes, compRes] = await Promise.all([
        supabase.rpc("get_hub_reputation", { p_hub_store_id: store.id }),
        supabase.rpc("get_hub_complaints_detail", { p_hub_store_id: store.id }),
      ]);
      setReputation((repRes.data as StoreReputation[]) ?? []);
      setComplaints((compRes.data as ComplaintDetail[]) ?? []);
      setLoading(false);
    }
    load();
  }, [store.id]);

  // Quem tem mais reclamação em aberto, ou nota mais baixa, sobe pro topo
  // — é o risco que precisa de atenção primeiro.
  const sorted = useMemo(
    () =>
      [...reputation].sort((a, b) => {
        if (b.complaint_open_count !== a.complaint_open_count) return b.complaint_open_count - a.complaint_open_count;
        const ratingA = a.avg_rating ?? 5;
        const ratingB = b.avg_rating ?? 5;
        return ratingA - ratingB;
      }),
    [reputation],
  );

  const complaintsByStore = useMemo(() => {
    const map = new Map<string, ComplaintDetail[]>();
    for (const c of complaints) {
      const list = map.get(c.store_id) ?? [];
      list.push(c);
      map.set(c.store_id, list);
    }
    return map;
  }, [complaints]);

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">Carregando…</div>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Reputação</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Nota e reclamação de cada afiliado — pra você enxergar risco antes que vire prejuízo pra marca inteira.
        Não mostra dado do cliente (nome/telefone), só a categoria e o que ele descreveu.
      </p>

      {sorted.length === 0 && <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Nenhum afiliado ainda.</p>}

      <div className="mt-4 flex flex-col gap-2">
        {sorted.map((r) => {
          const storeComplaints = complaintsByStore.get(r.store_id) ?? [];
          const expanded = expandedStoreId === r.store_id;
          const risky = r.complaint_open_count > 0 || (r.avg_rating !== null && r.avg_rating < 3.5);
          return (
            <div
              key={r.store_id}
              className={`rounded-xl border p-4 ${
                risky ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900 dark:text-slate-50">{r.store_name}</p>
                {r.complaint_open_count > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-400">
                    {r.complaint_open_count} em aberto
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-4 text-sm">
                <span className="text-slate-600 dark:text-slate-300">
                  ⭐ {r.avg_rating !== null ? r.avg_rating.toFixed(1) : "—"}{" "}
                  <span className="text-xs text-slate-400">({r.review_count} avaliação{r.review_count === 1 ? "" : "ões"})</span>
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  📋 {r.complaint_count} reclamação{r.complaint_count === 1 ? "" : "ões"} no total
                </span>
              </div>
              {storeComplaints.length > 0 && (
                <button
                  onClick={() => setExpandedStoreId(expanded ? null : r.store_id)}
                  className="mt-2 text-xs font-semibold text-blue-900 dark:text-blue-300"
                >
                  {expanded ? "Esconder reclamações" : "Ver reclamações"}
                </button>
              )}
              {expanded && (
                <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                  {storeComplaints.map((c) => {
                    const status = STATUS_LABEL[c.status] ?? STATUS_LABEL.aberta;
                    return (
                      <div key={c.id} className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {CATEGORY_LABEL[c.category] ?? c.category}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status.style}`}>{status.text}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{c.description}</p>
                        <p className="mt-1 text-[10px] text-slate-400">{formatDate(c.created_at)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
