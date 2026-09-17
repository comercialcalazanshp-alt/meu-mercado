"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { printHtml } from "@/lib/receipt";
import { Card, Section, PrimaryButton, SecondaryButton, SelectField } from "@/components/ui";
import { useThemeColors } from "@/components/ui/theme";

const ORIENTACAO_FINANCEIRA_PERGUNTA =
  "Acabei de fechar o caixa. Com base nesse fechamento e no acumulado do período, quanto eu já posso tirar pra mim (pró-labore), quanto preciso deixar de capital de giro, e quanto sobra pra pensar em investir?";

type CashSession = {
  id: string;
  opening_amount: number;
  status: "aberto" | "fechado";
  opened_at: string;
  closed_at: string | null;
  closing_amount_declared: number | null;
  expected_cash: number | null;
  cash_difference: number | null;
  revenue_total: number | null;
  revenue_by_payment: Record<string, number> | null;
  opened_by: string | null;
  closed_by: string | null;
};

type CashSummary = {
  orders_count: number;
  revenue_total: number;
  expected_cash: number;
  revenue_by_payment: Record<string, number>;
};

type CashMovement = {
  id: string;
  type: "sangria" | "reforco";
  amount: number;
  description: string | null;
  created_at: string;
};

const PAYMENT_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao: "Cartão",
  fiado: "Crediário",
  "site/outro": "Site / outro",
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function Caixa() {
  const store = useStore();
  const COLOR_HEX = useThemeColors();
  const [loading, setLoading] = useState(true);
  const [openSession, setOpenSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CashSummary | null>(null);

  const [openingAmount, setOpeningAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const [movementType, setMovementType] = useState<"sangria" | "reforco">("sangria");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementDescription, setMovementDescription] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);

  const [closing, setClosing] = useState(false);
  const [declaredAmount, setDeclaredAmount] = useState("");
  const [closeResult, setCloseResult] = useState<string | null>(null);
  const [lastClosedSession, setLastClosedSession] = useState<CashSession | null>(null);

  async function loadAll() {
    setLoading(true);
    const supabase = getSupabase();

    const [{ data: openRows }, { data: historyRows }] = await Promise.all([
      supabase
        .from("cash_sessions")
        .select(
          "id, opening_amount, status, opened_at, closed_at, closing_amount_declared, expected_cash, cash_difference, revenue_total, revenue_by_payment, opened_by, closed_by",
        )
        .eq("store_id", store.id)
        .eq("status", "aberto")
        .maybeSingle(),
      supabase
        .from("cash_sessions")
        .select(
          "id, opening_amount, status, opened_at, closed_at, closing_amount_declared, expected_cash, cash_difference, revenue_total, revenue_by_payment, opened_by, closed_by",
        )
        .eq("store_id", store.id)
        .eq("status", "fechado")
        .order("closed_at", { ascending: false })
        .limit(20),
    ]);

    setOpenSession(openRows ?? null);
    setHistory(historyRows ?? []);

    if (openRows) {
      const { data: movementRows } = await supabase
        .from("cash_movements")
        .select("id, type, amount, description, created_at")
        .eq("session_id", openRows.id)
        .order("created_at", { ascending: false });
      setMovements(movementRows ?? []);
      loadSummary(openRows.id);
    } else {
      setMovements([]);
      setSummary(null);
    }
    setLoading(false);
  }

  async function loadSummary(sessionId: string) {
    const { data } = await getSupabase().rpc("cash_session_summary", { p_session_id: sessionId });
    setSummary(data?.[0] ?? null);
  }

  useEffect(() => {
    loadAll();
    const channel = getSupabase()
      .channel(`caixa-orders-${store.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `store_id=eq.${store.id}` },
        () => loadAll(),
      )
      .subscribe();
    return () => {
      getSupabase().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleOpen(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(openingAmount.replace(",", "."));
    if (Number.isNaN(value) || value < 0) {
      setError("Informe um valor inicial válido.");
      return;
    }
    setSaving(true);
    const { error: insertError } = await getSupabase()
      .from("cash_sessions")
      .insert({ store_id: store.id, opening_amount: value });
    setSaving(false);
    if (insertError) {
      setError("Não deu pra abrir o caixa: " + insertError.message);
      return;
    }
    setOpeningAmount("");
    loadAll();
  }

  async function handleMovement(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!openSession) return;
    const value = Number(movementAmount.replace(",", "."));
    if (Number.isNaN(value) || value <= 0) {
      setError("Informe um valor válido.");
      return;
    }
    setSavingMovement(true);
    const { error: insertError } = await getSupabase().from("cash_movements").insert({
      session_id: openSession.id,
      type: movementType,
      amount: value,
      description: movementDescription.trim() || null,
    });
    setSavingMovement(false);
    if (insertError) {
      setError("Não deu pra registrar: " + insertError.message);
      return;
    }
    setMovementAmount("");
    setMovementDescription("");
    loadAll();
  }

  async function deleteMovement(id: string) {
    if (!window.confirm("Apagar esse lançamento? Isso muda o valor esperado no fechamento.")) return;
    await getSupabase().from("cash_movements").delete().eq("id", id);
    loadAll();
  }

  function printClosingReport(session: {
    opened_at: string;
    closed_at: string | null;
    opening_amount: number;
    expected_cash: number | null;
    closing_amount_declared: number | null;
    cash_difference: number | null;
    revenue_total: number | null;
    revenue_by_payment: Record<string, number> | null;
    opened_by: string | null;
    closed_by: string | null;
  }) {
    const paperMm = store.receipt_paper_mm || 55;
    const paymentHtml = session.revenue_by_payment
      ? Object.entries(session.revenue_by_payment)
          .map(
            (
              [method, total],
            ) => `<p class="row"><span>${PAYMENT_LABEL[method] ?? method}</span><span>${formatCurrency(total)}</span></p>`,
          )
          .join("")
      : "";
    // Mesma regra de tamanho da bobina do cupom de venda (buildReceiptHtml em
    // src/lib/receipt.ts) — sem o @page com altura automática, o navegador
    // imprime isso numa folha A4/Carta inteira e desperdiça bobina enorme
    // pra um resumo de poucas linhas.
    const html = `
      <html><head><title>Fechamento de caixa</title>
      <style>
        @page { size: ${paperMm}mm auto; margin: 0; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body{font-family:'Courier New',monospace;font-weight:700;width:${paperMm}mm;margin:0;padding:3mm 2mm;font-size:12px;color:#000;}
        h2{margin:0 0 1mm;font-size:15px;text-align:center;letter-spacing:0.5px;}
        p{margin:1mm 0;}
        .center{text-align:center;}
        .muted{font-size:10px;text-align:center;font-weight:400;}
        .divider{border-top:1px dashed #000;margin:2mm 0;}
        .row{display:flex;justify-content:space-between;font-size:12px;}
        .total{font-size:15px;border-top:2px solid #000;margin-top:2mm;padding-top:2mm;display:flex;justify-content:space-between;}
      </style></head><body>
      <h2>${store.name}</h2>
      <p class="muted">Fechamento de caixa</p>
      <div class="divider"></div>
      <p class="row"><span>Aberto</span><span>${formatDateTime(session.opened_at)}</span></p>
      ${session.opened_by ? `<p class="muted">por ${session.opened_by}</p>` : ""}
      <p class="row"><span>Fechado</span><span>${session.closed_at ? formatDateTime(session.closed_at) : "—"}</span></p>
      ${session.closed_by ? `<p class="muted">por ${session.closed_by}</p>` : ""}
      <div class="divider"></div>
      <p class="row"><span>Valor inicial</span><span>${formatCurrency(session.opening_amount)}</span></p>
      <p class="row"><span>Faturamento total</span><span>${formatCurrency(session.revenue_total ?? 0)}</span></p>
      ${paymentHtml}
      <div class="divider"></div>
      <p class="row"><span>Esperado em dinheiro</span><span>${formatCurrency(session.expected_cash ?? 0)}</span></p>
      <p class="row"><span>Contado</span><span>${formatCurrency(session.closing_amount_declared ?? 0)}</span></p>
      <p class="total"><span>Diferença</span><span>${formatCurrency(session.cash_difference ?? 0)}</span></p>
      </body></html>
    `;
    printHtml(html);
  }

  async function handleClose(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!openSession) return;
    const value = Number(declaredAmount.replace(",", "."));
    if (Number.isNaN(value) || value < 0) {
      setError("Informe quanto você contou de verdade no caixa.");
      return;
    }
    setClosing(true);
    const { data, error: rpcError } = await getSupabase().rpc("close_cash_session", {
      p_session_id: openSession.id,
      p_declared: value,
    });
    setClosing(false);
    if (rpcError) {
      setError("Não deu pra fechar o caixa: " + rpcError.message);
      return;
    }
    const result = data?.[0];
    const diff = result?.cash_difference ?? 0;
    if (Math.abs(diff) < 0.5) {
      setCloseResult("Caixa fechado. Bateu certinho com o esperado.");
    } else if (diff > 0) {
      setCloseResult(`Caixa fechado. Sobrou ${formatCurrency(diff)} a mais do que o esperado.`);
    } else {
      setCloseResult(`Caixa fechado. Faltou ${formatCurrency(Math.abs(diff))} em relação ao esperado.`);
    }
    setLastClosedSession({
      ...openSession,
      status: "fechado",
      closed_at: new Date().toISOString(),
      closing_amount_declared: value,
      expected_cash: result?.expected_cash ?? null,
      cash_difference: diff,
      revenue_total: result?.revenue_total ?? null,
      revenue_by_payment: summary?.revenue_by_payment ?? null,
    });
    setDeclaredAmount("");
    loadAll();
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
        ))}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-black">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-36 left-1/3 h-[420px] w-[420px] rounded-full opacity-25 blur-[100px]"
        style={{ background: `radial-gradient(circle, ${COLOR_HEX.accent}30, transparent 65%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 -right-16 h-[360px] w-[360px] rounded-full opacity-20 blur-[100px]"
        style={{ background: `radial-gradient(circle, ${COLOR_HEX.positive}22, transparent 65%)` }}
      />

      <div className="relative mx-auto max-w-2xl space-y-4 px-4 py-6 text-[#F5F3EF] sm:px-6">
        <h1 className="text-xl font-extrabold">Caixa</h1>
        {error && (
          <p className="text-sm font-medium" style={{ color: COLOR_HEX.negative }}>
            {error}
          </p>
        )}

        {!openSession ? (
          <Card>
            <Section dot={COLOR_HEX.accent} label="Abrir caixa">
              <p className="text-sm text-white/50">Quanto tem de dinheiro no caixa agora?</p>
              <form onSubmit={handleOpen} className="mt-3 flex items-center gap-2">
                <input
                  value={openingAmount}
                  onChange={(e) => setOpeningAmount(e.target.value)}
                  placeholder="R$ 0,00"
                  inputMode="decimal"
                  className="w-40 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[var(--mm-accent)]/50 focus:outline-none"
                />
                <PrimaryButton hex={COLOR_HEX.accent} type="submit" disabled={saving}>
                  {saving ? "Abrindo…" : "Abrir caixa"}
                </PrimaryButton>
              </form>
            </Section>
          </Card>
        ) : (
          <>
            <Card style={{ borderColor: `${COLOR_HEX.positive}40` }}>
              <Section dot={COLOR_HEX.positive} label="Caixa aberto">
                <p className="text-sm text-white/50">
                  Aberto em {formatDateTime(openSession.opened_at)} com{" "}
                  <span className="font-semibold text-white/80">{formatCurrency(openSession.opening_amount)}</span>
                  {openSession.opened_by ? ` por ${openSession.opened_by}` : ""}
                </p>
                {summary && (
                  <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-3">
                    <div>
                      <p className="text-[11px] text-white/35">Vendas hoje</p>
                      <p className="text-lg font-bold tabular-nums text-white">{summary.orders_count}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-white/35">Faturamento</p>
                      <p className="text-lg font-bold tabular-nums text-white">{formatCurrency(summary.revenue_total)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-white/35">Dinheiro esperado</p>
                      <p className="text-lg font-bold tabular-nums text-white">{formatCurrency(summary.expected_cash)}</p>
                    </div>
                  </div>
                )}
              </Section>
            </Card>

            <Card>
              <Section dot={COLOR_HEX.warning} label="Sangria / reforço">
                <form onSubmit={handleMovement} className="flex flex-wrap items-end gap-2">
                  <SelectField value={movementType} onChange={(e) => setMovementType(e.target.value as "sangria" | "reforco")}>
                    <option value="sangria">Sangria (retirar)</option>
                    <option value="reforco">Reforço (colocar a mais)</option>
                  </SelectField>
                  <input
                    value={movementAmount}
                    onChange={(e) => setMovementAmount(e.target.value)}
                    placeholder="R$ 0,00"
                    inputMode="decimal"
                    className="w-32 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[var(--mm-accent)]/50 focus:outline-none"
                  />
                  <input
                    value={movementDescription}
                    onChange={(e) => setMovementDescription(e.target.value)}
                    placeholder="Motivo (opcional)"
                    className="w-full rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[var(--mm-accent)]/50 focus:outline-none sm:min-w-0 sm:flex-1"
                  />
                  <SecondaryButton type="submit" disabled={savingMovement}>
                    {savingMovement ? "Registrando…" : "Registrar"}
                  </SecondaryButton>
                </form>
                {movements.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3 text-sm">
                    {movements.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 text-white/50">
                        <span className="truncate">
                          {m.type === "sangria" ? "Sangria" : "Reforço"}
                          {m.description ? ` — ${m.description}` : ""} · {formatDateTime(m.created_at)}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span
                            className="font-medium tabular-nums"
                            style={{ color: m.type === "sangria" ? COLOR_HEX.negative : COLOR_HEX.positive }}
                          >
                            {m.type === "sangria" ? "−" : "+"}
                            {formatCurrency(m.amount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteMovement(m.id)}
                            className="text-xs hover:underline"
                            style={{ color: COLOR_HEX.negative }}
                          >
                            Apagar
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </Card>

            <Card>
              <Section dot={COLOR_HEX.negative} label="Fechar caixa">
                <p className="text-sm text-white/50">
                  Conte o dinheiro de verdade no caixa e informe abaixo — o sistema compara com o esperado (valor
                  inicial + vendas em dinheiro do PDV + reforços − sangrias).
                </p>
                {summary && (
                  <p className="mt-1 text-sm text-white/60">
                    Valor esperado agora: <strong className="text-white">{formatCurrency(summary.expected_cash)}</strong>
                  </p>
                )}
                <form onSubmit={handleClose} className="mt-3 flex items-center gap-2">
                  <input
                    value={declaredAmount}
                    onChange={(e) => setDeclaredAmount(e.target.value)}
                    placeholder="R$ 0,00"
                    inputMode="decimal"
                    className="w-40 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[var(--mm-accent)]/50 focus:outline-none"
                  />
                  <PrimaryButton hex={COLOR_HEX.negative} type="submit" disabled={closing}>
                    {closing ? "Fechando…" : "🔒 Fechar caixa"}
                  </PrimaryButton>
                </form>
                {summary &&
                  declaredAmount.trim() !== "" &&
                  (() => {
                    const declared = Number(declaredAmount.replace(",", ".")) || 0;
                    const liveDiff = declared - summary.expected_cash;
                    const hex = Math.abs(liveDiff) < 0.5 ? COLOR_HEX.positive : liveDiff > 0 ? COLOR_HEX.accent : COLOR_HEX.negative;
                    return (
                      <p className="mt-1.5 text-sm font-medium" style={{ color: hex }}>
                        {Math.abs(liveDiff) < 0.5
                          ? "✓ Bate certinho com o esperado"
                          : liveDiff > 0
                            ? `Vai sobrar ${formatCurrency(liveDiff)}`
                            : `Vai faltar ${formatCurrency(Math.abs(liveDiff))}`}
                      </p>
                    );
                  })()}
                {closeResult && (
                  <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="text-sm text-white/70">{closeResult}</p>
                    {lastClosedSession && (
                      <div className="mt-2 flex flex-wrap items-center gap-4">
                        <button
                          type="button"
                          onClick={() => printClosingReport(lastClosedSession)}
                          className="text-sm font-medium underline underline-offset-2"
                          style={{ color: COLOR_HEX.accent }}
                        >
                          🖨️ Imprimir resumo do fechamento
                        </button>
                        <Link
                          href={`/painel/assistente?pergunta=${encodeURIComponent(ORIENTACAO_FINANCEIRA_PERGUNTA)}`}
                          className="text-sm font-medium underline underline-offset-2"
                          style={{ color: COLOR_HEX.positive }}
                        >
                          💬 Pedir orientação financeira
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </Section>
            </Card>
          </>
        )}

        <Card>
          <Section dot={COLOR_HEX.afil} label="Histórico de fechamentos">
            {history.length === 0 && <p className="text-sm text-white/35">Nenhum caixa fechado ainda.</p>}
            <div className="space-y-2">
              {history.map((s) => {
                const diffHex =
                  Math.abs(s.cash_difference ?? 0) < 0.5
                    ? COLOR_HEX.positive
                    : (s.cash_difference ?? 0) > 0
                      ? COLOR_HEX.accent
                      : COLOR_HEX.negative;
                return (
                  <div key={s.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-white/50">
                        {formatDateTime(s.opened_at)} até {s.closed_at ? formatDateTime(s.closed_at) : "—"}
                      </span>
                      <span className="font-medium" style={{ color: diffHex }}>
                        {Math.abs(s.cash_difference ?? 0) < 0.5
                          ? "Bateu certinho"
                          : (s.cash_difference ?? 0) > 0
                            ? `Sobrou ${formatCurrency(s.cash_difference ?? 0)}`
                            : `Faltou ${formatCurrency(Math.abs(s.cash_difference ?? 0))}`}
                      </span>
                    </div>
                    <p className="mt-1 text-white/40">
                      Esperado {formatCurrency(s.expected_cash ?? 0)} · Contado {formatCurrency(s.closing_amount_declared ?? 0)} ·
                      Faturamento total {formatCurrency(s.revenue_total ?? 0)}
                    </p>
                    {s.revenue_by_payment && Object.keys(s.revenue_by_payment).length > 0 && (
                      <p className="mt-1 text-xs text-white/30">
                        {Object.entries(s.revenue_by_payment)
                          .map(([method, total]) => `${PAYMENT_LABEL[method] ?? method}: ${formatCurrency(total)}`)
                          .join(" · ")}
                      </p>
                    )}
                    {(s.opened_by || s.closed_by) && (
                      <p className="mt-1 text-xs text-white/30">
                        {s.opened_by && `Aberto por ${s.opened_by}`}
                        {s.opened_by && s.closed_by && " · "}
                        {s.closed_by && `Fechado por ${s.closed_by}`}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => printClosingReport(s)}
                      className="mt-2 text-xs font-medium underline underline-offset-2"
                      style={{ color: COLOR_HEX.accent }}
                    >
                      🖨️ Imprimir resumo
                    </button>
                  </div>
                );
              })}
            </div>
          </Section>
        </Card>
      </div>
    </div>
  );
}
