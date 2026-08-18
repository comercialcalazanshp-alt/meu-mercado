"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import type { AffiliatePartnership, AffiliateSettlementTransaction, AffiliateAiPurchase } from "@/lib/affiliate-types";

function formatCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

// Comissão real da Hub sobre uma transação de venda: "amount" já é o que
// fica com o afiliado (o "repasse"), então a comissão é a diferença —
// mesma matemática usada no Dashboard (hubCommission).
function hubCommission(amount: number, pct: number) {
  if (pct <= 0 || pct >= 100) return 0;
  return amount * (pct / (100 - pct));
}

const PAYOUT_LABEL: Record<string, string> = { manual: "Manual", split_automatico: "Split automático" };

type ExtratoRow = {
  id: string;
  kind: "venda" | "repasse" | "estorno" | "avulsa";
  amount: number;
  created_at: string;
  partnershipId: string;
  note: string | null;
};

export default function Financas() {
  const store = useStore();
  const [partnerships, setPartnerships] = useState<AffiliatePartnership[]>([]);
  const [settlements, setSettlements] = useState<AffiliateSettlementTransaction[]>([]);
  const [purchases, setPurchases] = useState<AffiliateAiPurchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabase();
      const { data: partnershipRows } = await supabase
        .from("affiliate_partnerships")
        .select("*")
        .eq("hub_store_id", store.id);
      if (cancelled) return;
      const list = (partnershipRows as AffiliatePartnership[]) ?? [];
      setPartnerships(list);

      const ids = list.map((p) => p.id);
      if (ids.length === 0) {
        setSettlements([]);
        setPurchases([]);
        setLoading(false);
        return;
      }

      const [settlementsRes, purchasesRes] = await Promise.all([
        supabase
          .from("affiliate_settlement_transactions")
          .select("*")
          .in("partnership_id", ids)
          .order("created_at", { ascending: false })
          .limit(40),
        supabase
          .from("affiliate_ai_purchases")
          .select("*")
          .in("partnership_id", ids)
          .not("paid_at", "is", null)
          .order("paid_at", { ascending: false })
          .limit(40),
      ]);
      if (cancelled) return;
      setSettlements((settlementsRes.data as AffiliateSettlementTransaction[]) ?? []);
      setPurchases((purchasesRes.data as AffiliateAiPurchase[]) ?? []);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const partnershipsById = useMemo(() => new Map(partnerships.map((p) => [p.id, p])), [partnerships]);
  const activePartnerships = useMemo(() => partnerships.filter((p) => p.active), [partnerships]);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const commissionThisMonth = useMemo(
    () =>
      settlements
        .filter((s) => s.type === "venda" && new Date(s.created_at) >= startOfMonth)
        .reduce((sum, s) => sum + hubCommission(s.amount, partnershipsById.get(s.partnership_id)?.commission_percent ?? 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settlements, partnershipsById],
  );

  const extraSalesThisMonth = useMemo(
    () => purchases.filter((p) => p.paid_at && new Date(p.paid_at) >= startOfMonth).reduce((s, p) => s + p.price, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [purchases],
  );

  const mrr = useMemo(() => activePartnerships.reduce((s, p) => s + (p.subscription_price ?? 0), 0), [activePartnerships]);
  const overdue = useMemo(
    () => activePartnerships.filter((p) => p.subscription_due_at && new Date(p.subscription_due_at) < now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePartnerships],
  );
  const overdueAmount = useMemo(() => overdue.reduce((s, p) => s + (p.subscription_price ?? 0), 0), [overdue]);
  const toRepassar = useMemo(() => activePartnerships.reduce((s, p) => s + Math.max(0, p.balance), 0), [activePartnerships]);

  const extrato: ExtratoRow[] = useMemo(() => {
    const rows: ExtratoRow[] = [
      ...settlements.map((s) => ({
        id: s.id,
        kind: s.type as ExtratoRow["kind"],
        amount: s.amount,
        created_at: s.created_at,
        partnershipId: s.partnership_id,
        note: s.note,
      })),
      ...purchases
        .filter((p) => p.paid_at)
        .map((p) => ({
          id: p.id,
          kind: "avulsa" as const,
          amount: p.price,
          created_at: p.paid_at as string,
          partnershipId: p.partnership_id,
          note: `pacote +${p.image_qty} imagens`,
        })),
    ];
    return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 30);
  }, [settlements, purchases]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-white/40">Carregando…</div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-black">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -top-44 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-40 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(92,172,255,0.18), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-36 top-56 h-[420px] w-[420px] rounded-full opacity-40 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(52,232,140,0.14), transparent 65%)" }}
      />

      <div className="relative max-w-4xl px-4 py-8 text-[#F5F3EF] sm:px-6">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#F0BB5E] text-[11px] font-extrabold text-[#241705]">
            MM
          </span>
          <div>
            <h1 className="text-base font-extrabold">Finanças</h1>
            <p className="mt-0.5 text-[11.5px] text-white/35">Comissão, mensalidade e vendas avulsas dos afiliados</p>
          </div>
        </div>

        <div className="mb-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">Comissão do mês</p>
            <p className="mt-1.5 text-[19px] font-extrabold tabular-nums text-[#5CACFF]">{formatCurrency(commissionThisMonth)}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">Vendas avulsas do mês</p>
            <p className="mt-1.5 text-[19px] font-extrabold tabular-nums text-[#5CACFF]">{formatCurrency(extraSalesThisMonth)}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">MRR (mensalidades)</p>
            <p className="mt-1.5 text-[19px] font-extrabold tabular-nums text-[#F5F3EF]">{formatCurrency(mrr)}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 backdrop-blur-xl">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-white/30">A repassar</p>
            <p className="mt-1.5 text-[19px] font-extrabold tabular-nums text-[#FF5C68]">{formatCurrency(toRepassar)}</p>
          </div>
        </div>

        {overdue.length > 0 && (
          <div className="mb-2.5 rounded-2xl border border-[#FF5C68]/25 bg-[#FF5C68]/[0.06] p-4">
            <p className="text-[12.5px] font-bold text-[#FF5C68]">
              {overdue.length} mensalidade(s) atrasada(s) — {formatCurrency(overdueAmount)} no total
            </p>
            <div className="mt-2 flex flex-col gap-1">
              {overdue.map((p) => (
                <p key={p.id} className="text-[12px] text-white/55">
                  <b className="text-white/80">{p.owner_name}</b> — venceu em {formatDate(p.subscription_due_at as string)} ·{" "}
                  {formatCurrency(p.subscription_price ?? 0)}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="mb-2.5 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-5 backdrop-blur-xl">
          <h2 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-white/45">Situação por afiliado</h2>
          {partnerships.length === 0 ? (
            <p className="text-[13px] text-white/35">Nenhum afiliado cadastrado ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[12.5px]">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wide text-white/30">
                    <th className="pb-2 font-bold">Afiliado</th>
                    <th className="pb-2 font-bold">Comissão</th>
                    <th className="pb-2 font-bold">Mensalidade</th>
                    <th className="pb-2 font-bold">Vencimento</th>
                    <th className="pb-2 font-bold">Saldo a repassar</th>
                    <th className="pb-2 font-bold">Recebimento</th>
                  </tr>
                </thead>
                <tbody>
                  {partnerships.map((p) => {
                    const isOverdue = p.active && p.subscription_due_at && new Date(p.subscription_due_at) < now;
                    return (
                      <tr key={p.id} className="border-t border-white/[0.06]">
                        <td className="py-2.5 pr-2">
                          <p className="font-semibold text-white/85">{p.owner_name}</p>
                          <p className="text-[11px] text-white/30">{p.category}</p>
                        </td>
                        <td className="py-2.5 pr-2 tabular-nums text-white/70">{p.commission_percent}%</td>
                        <td className="py-2.5 pr-2 tabular-nums text-white/70">
                          {p.subscription_price ? formatCurrency(p.subscription_price) : "—"}
                        </td>
                        <td className="py-2.5 pr-2">
                          {p.subscription_due_at ? (
                            <span className={isOverdue ? "font-semibold text-[#FF5C68]" : "text-white/55"}>
                              {formatDate(p.subscription_due_at)}
                              {isOverdue ? " · atrasado" : ""}
                            </span>
                          ) : (
                            <span className="text-white/30">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-2 tabular-nums text-[#34E88C]">{formatCurrency(Math.max(0, p.balance))}</td>
                        <td className="py-2.5 pr-2 text-white/55">{PAYOUT_LABEL[p.payout_method] ?? p.payout_method}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-5 backdrop-blur-xl">
          <h2 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-white/45">Extrato recente</h2>
          {extrato.length === 0 ? (
            <p className="text-[13px] text-white/35">Nenhuma movimentação ainda.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {extrato.map((row) => {
                const p = partnershipsById.get(row.partnershipId);
                const isCredit = row.kind === "venda" || row.kind === "avulsa";
                const label =
                  row.kind === "venda" ? "Comissão de venda" : row.kind === "avulsa" ? "Venda avulsa" : row.kind === "repasse" ? "Repasse" : "Estorno";
                const displayAmount =
                  row.kind === "venda" ? hubCommission(row.amount, p?.commission_percent ?? 0) : row.amount;
                return (
                  <div key={`${row.kind}-${row.id}`} className="flex items-center justify-between gap-2 border-b border-white/[0.05] pb-2.5 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold text-white/80">
                        {label} · {p?.owner_name ?? "afiliado"}
                      </p>
                      <p className="text-[11px] text-white/30">
                        {formatDate(row.created_at)}
                        {row.note ? ` · ${row.note}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 tabular-nums text-[13px] font-bold ${isCredit ? "text-[#34E88C]" : "text-[#FF5C68]"}`}>
                      {isCredit ? "+" : "−"}
                      {formatCurrency(displayAmount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
