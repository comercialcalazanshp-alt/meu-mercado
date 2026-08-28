"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

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
    const win = window.open("", "_blank", "width=380,height=520");
    if (!win) return;
    const paymentHtml = session.revenue_by_payment
      ? Object.entries(session.revenue_by_payment)
          .map(([method, total]) => `<p>${PAYMENT_LABEL[method] ?? method}: ${formatCurrency(total)}</p>`)
          .join("")
      : "";
    win.document.write(`
      <html><head><title>Fechamento de caixa</title>
      <style>body{font-family:sans-serif;padding:16px;font-size:14px;} .total{font-weight:bold;margin-top:8px;}</style>
      </head><body>
      <h2>${store.name}</h2>
      <p>Fechamento de caixa</p>
      <p>Aberto: ${formatDateTime(session.opened_at)}${session.opened_by ? ` por ${session.opened_by}` : ""}</p>
      <p>Fechado: ${session.closed_at ? formatDateTime(session.closed_at) : "—"}${session.closed_by ? ` por ${session.closed_by}` : ""}</p>
      <p>Valor inicial: ${formatCurrency(session.opening_amount)}</p>
      <p>Faturamento total: ${formatCurrency(session.revenue_total ?? 0)}</p>
      ${paymentHtml}
      <p>Esperado em dinheiro: ${formatCurrency(session.expected_cash ?? 0)}</p>
      <p>Contado: ${formatCurrency(session.closing_amount_declared ?? 0)}</p>
      <p class="total">Diferença: ${formatCurrency(session.cash_difference ?? 0)}</p>
      <script>window.print();</script>
      </body></html>
    `);
    win.document.close();
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
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Caixa</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!openSession ? (
        <form
          onSubmit={handleOpen}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Abrir caixa
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Quanto tem de dinheiro no caixa agora?
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={openingAmount}
              onChange={(e) => setOpeningAmount(e.target.value)}
              placeholder="R$ 0,00"
              inputMode="decimal"
              className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
            >
              {saving ? "Abrindo…" : "Abrir caixa"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900/50 dark:bg-green-950/30">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
              Caixa aberto
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Aberto em {formatDateTime(openSession.opened_at)} com{" "}
              {formatCurrency(openSession.opening_amount)}
              {openSession.opened_by ? ` por ${openSession.opened_by}` : ""}
            </p>
            {summary && (
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-green-200 pt-3 dark:border-green-900/50">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Vendas hoje</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-50">{summary.orders_count}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Faturamento</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-50">
                    {formatCurrency(summary.revenue_total)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Dinheiro esperado agora</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-50">
                    {formatCurrency(summary.expected_cash)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={handleMovement}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Sangria / reforço
            </h2>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <select
                value={movementType}
                onChange={(e) => setMovementType(e.target.value as "sangria" | "reforco")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                <option value="sangria">Sangria (retirar)</option>
                <option value="reforco">Reforço (colocar a mais)</option>
              </select>
              <input
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
                placeholder="R$ 0,00"
                inputMode="decimal"
                className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
              <input
                value={movementDescription}
                onChange={(e) => setMovementDescription(e.target.value)}
                placeholder="Motivo (opcional)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 sm:min-w-0 sm:flex-1"
              />
              <button
                type="submit"
                disabled={savingMovement}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
              >
                {savingMovement ? "Registrando…" : "Registrar"}
              </button>
            </div>
            {movements.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400">
                    <span>
                      {m.type === "sangria" ? "Sangria" : "Reforço"}
                      {m.description ? ` — ${m.description}` : ""} ·{" "}
                      {formatDateTime(m.created_at)}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={m.type === "sangria" ? "text-red-600" : "text-green-600"}>
                        {m.type === "sangria" ? "−" : "+"}
                        {formatCurrency(m.amount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteMovement(m.id)}
                        className="text-xs text-red-600 hover:underline dark:text-red-400"
                      >
                        Apagar
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </form>

          <form
            onSubmit={handleClose}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Fechar caixa
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Conte o dinheiro de verdade no caixa e informe abaixo — o sistema compara com o
              esperado (valor inicial + vendas em dinheiro do PDV + reforços − sangrias).
            </p>
            {summary && (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Valor esperado agora: <strong>{formatCurrency(summary.expected_cash)}</strong>
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <input
                value={declaredAmount}
                onChange={(e) => setDeclaredAmount(e.target.value)}
                placeholder="R$ 0,00"
                inputMode="decimal"
                className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
              <button
                type="submit"
                disabled={closing}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {closing ? "Fechando…" : "🔒 Fechar caixa"}
              </button>
            </div>
            {summary && declaredAmount.trim() !== "" && (() => {
              const declared = Number(declaredAmount.replace(",", ".")) || 0;
              const liveDiff = declared - summary.expected_cash;
              return (
                <p
                  className={`mt-1 text-sm font-medium ${
                    Math.abs(liveDiff) < 0.5
                      ? "text-green-600"
                      : liveDiff > 0
                        ? "text-blue-600"
                        : "text-red-600"
                  }`}
                >
                  {Math.abs(liveDiff) < 0.5
                    ? "✓ Bate certinho com o esperado"
                    : liveDiff > 0
                      ? `Vai sobrar ${formatCurrency(liveDiff)}`
                      : `Vai faltar ${formatCurrency(Math.abs(liveDiff))}`}
                </p>
              );
            })()}
            {closeResult && (
              <div className="mt-2">
                <p className="text-sm text-slate-700 dark:text-slate-300">{closeResult}</p>
                {lastClosedSession && (
                  <button
                    type="button"
                    onClick={() => printClosingReport(lastClosedSession)}
                    className="mt-1 text-sm font-medium text-blue-900 underline dark:text-blue-400"
                  >
                    🖨️ Imprimir resumo do fechamento
                  </button>
                )}
              </div>
            )}
          </form>
        </>
      )}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Histórico de fechamentos
        </h2>
        {history.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">Nenhum caixa fechado ainda.</p>
        )}
        <div className="mt-2 space-y-2">
          {history.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-400">
                  {formatDateTime(s.opened_at)} até {s.closed_at ? formatDateTime(s.closed_at) : "—"}
                </span>
                <span
                  className={`font-medium ${
                    Math.abs(s.cash_difference ?? 0) < 0.5
                      ? "text-green-600"
                      : (s.cash_difference ?? 0) > 0
                        ? "text-blue-600"
                        : "text-red-600"
                  }`}
                >
                  {Math.abs(s.cash_difference ?? 0) < 0.5
                    ? "Bateu certinho"
                    : (s.cash_difference ?? 0) > 0
                      ? `Sobrou ${formatCurrency(s.cash_difference ?? 0)}`
                      : `Faltou ${formatCurrency(Math.abs(s.cash_difference ?? 0))}`}
                </span>
              </div>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                Esperado {formatCurrency(s.expected_cash ?? 0)} · Contado{" "}
                {formatCurrency(s.closing_amount_declared ?? 0)} · Faturamento total{" "}
                {formatCurrency(s.revenue_total ?? 0)}
              </p>
              {s.revenue_by_payment && Object.keys(s.revenue_by_payment).length > 0 && (
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {Object.entries(s.revenue_by_payment)
                    .map(([method, total]) => `${PAYMENT_LABEL[method] ?? method}: ${formatCurrency(total)}`)
                    .join(" · ")}
                </p>
              )}
              {(s.opened_by || s.closed_by) && (
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {s.opened_by && `Aberto por ${s.opened_by}`}
                  {s.opened_by && s.closed_by && " · "}
                  {s.closed_by && `Fechado por ${s.closed_by}`}
                </p>
              )}
              <button
                type="button"
                onClick={() => printClosingReport(s)}
                className="mt-2 text-xs font-medium text-blue-900 underline dark:text-blue-400"
              >
                🖨️ Imprimir resumo
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
