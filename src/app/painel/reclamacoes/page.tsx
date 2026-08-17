"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Complaint = {
  id: string;
  order_id: string | null;
  customer_name: string;
  customer_phone: string;
  category: string;
  description: string;
  status: "aberta" | "em_andamento" | "resolvida";
  owner_reply: string | null;
  owner_reply_at: string | null;
  created_at: string;
  resolved_at: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  produto_errado: "Produto errado",
  produto_danificado: "Produto danificado",
  faltou_item: "Faltou item",
  atraso_entrega: "Atraso na entrega",
  cobranca_errada: "Cobrança errada",
  atendimento: "Atendimento",
  outro: "Outro problema",
};

const STATUS_LABEL: Record<Complaint["status"], string> = {
  aberta: "Aberta",
  em_andamento: "Em andamento",
  resolvida: "Resolvida",
};

const STATUS_STYLE: Record<Complaint["status"], string> = {
  aberta: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  em_andamento: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  resolvida: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function whatsappUrl(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/55${digits}?text=${encodeURIComponent(text)}`;
}

export default function Reclamacoes() {
  const store = useStore();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"todas" | Complaint["status"]>("todas");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("complaints")
      .select("id, order_id, customer_name, customer_phone, category, description, status, owner_reply, owner_reply_at, created_at, resolved_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Complaint[];
    setComplaints(rows);
    setReplyDrafts((prev) => {
      const next = { ...prev };
      for (const c of rows) if (next[c.id] === undefined) next[c.id] = c.owner_reply ?? "";
      return next;
    });
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const counts = useMemo(() => {
    const c = { aberta: 0, em_andamento: 0, resolvida: 0 };
    for (const item of complaints) c[item.status] += 1;
    return c;
  }, [complaints]);

  const filtered = filter === "todas" ? complaints : complaints.filter((c) => c.status === filter);

  async function updateStatus(id: string, status: Complaint["status"]) {
    const patch: { status: string; resolved_at?: string | null } = { status };
    if (status === "resolvida") patch.resolved_at = new Date().toISOString();
    else patch.resolved_at = null;
    setComplaints((prev) => prev.map((c) => (c.id === id ? { ...c, status, resolved_at: patch.resolved_at ?? null } : c)));
    await getSupabase().from("complaints").update(patch).eq("id", id);
  }

  async function saveReply(id: string) {
    const reply = replyDrafts[id]?.trim() ?? "";
    if (!reply) return;
    setSaving(id);
    const now = new Date().toISOString();
    const { error } = await getSupabase()
      .from("complaints")
      .update({ owner_reply: reply, owner_reply_at: now })
      .eq("id", id);
    setSaving(null);
    if (!error) {
      setComplaints((prev) => prev.map((c) => (c.id === id ? { ...c, owner_reply: reply, owner_reply_at: now } : c)));
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Central de Reclamações</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Quando um cliente relata um problema com um pedido, aparece aqui. Responda e marque como resolvida
        quando fechar o assunto — o cliente vê sua resposta na página do pedido dele.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {(["todas", "aberta", "em_andamento", "resolvida"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f
                ? "bg-blue-900 text-white dark:bg-blue-700"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {f === "todas" ? "Todas" : STATUS_LABEL[f]} ({f === "todas" ? complaints.length : counts[f]})
          </button>
        ))}
      </div>

      {loading && <p className="mt-6 text-sm text-slate-500">Carregando…</p>}

      {!loading && filtered.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
          Nenhuma reclamação {filter !== "todas" ? `com status "${STATUS_LABEL[filter]}"` : "por aqui"}. 🎉
        </p>
      )}

      <div className="mt-4 space-y-3">
        {filtered.map((c) => (
          <div
            key={c.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {CATEGORY_LABEL[c.category] ?? c.category}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {c.customer_name} · {c.customer_phone} · {formatDate(c.created_at)}
                  {c.order_id && ` · pedido #${c.order_id.slice(0, 8).toUpperCase()}`}
                </p>
              </div>
              <select
                value={c.status}
                onChange={(e) => updateStatus(c.id, e.target.value as Complaint["status"])}
                className={`rounded-full border-0 px-3 py-1 text-xs font-medium ${STATUS_STYLE[c.status]}`}
              >
                {(["aberta", "em_andamento", "resolvida"] as const).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{c.description}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={whatsappUrl(c.customer_phone, `Oi ${c.customer_name}, aqui é da ${store.name}. Vi sua reclamação sobre "${CATEGORY_LABEL[c.category] ?? c.category}" — `)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-green-700 hover:underline dark:text-green-400"
              >
                💬 Falar no WhatsApp
              </a>
            </div>

            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                Resposta (o cliente vê isso na página do pedido dele)
              </label>
              <textarea
                value={replyDrafts[c.id] ?? ""}
                onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                rows={2}
                placeholder="Escreva sua resposta pro cliente…"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => saveReply(c.id)}
                  disabled={saving === c.id || !(replyDrafts[c.id] ?? "").trim()}
                  className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-semibold text-amber-300 disabled:opacity-50 dark:bg-blue-800"
                >
                  {saving === c.id ? "Salvando…" : "Salvar resposta"}
                </button>
                {c.owner_reply_at && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    Respondido em {formatDate(c.owner_reply_at)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
