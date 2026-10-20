"use client";

import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type NotaCandidate = {
  id: string;
  name: string;
  barcode: string | null;
  price: number;
  cost_price: number | null;
  stock: number;
  sold_by_weight: boolean;
};

export type NotaLine = {
  idx: number;
  descricao: string;
  unidade: string;
  quantidade_nota: number;
  unidades_por_embalagem: number;
  quantidade_real: number;
  valor_total: number;
  custo_unitario: number;
  observacao: string;
  produto_id: string | null;
  confianca: "alta" | "media" | "baixa";
  divergente: boolean;
  candidatos: NotaCandidate[];
};

export type NotaResult = {
  nota: { fornecedor: string; numero: string; total: number | null; soma_itens: number; aviso: string | null };
  linhas: NotaLine[];
};

type RowState = {
  productId: string | null;
  qtd: string;
  custo: string;
  estoque: string;
  include: boolean;
  custoTouched: boolean;
  estoqueTouched: boolean;
};

const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (text: string) => Number(text.trim().replace(",", "."));
const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

// Custo novo muito longe do custo cadastrado quase sempre é produto errado ou
// número mal lido na foto — avisa e não marca sozinho.
function costJump(product: NotaCandidate | undefined, custo: number): number | null {
  if (!product || product.cost_price == null || product.cost_price <= 0 || !Number.isFinite(custo) || custo <= 0) return null;
  return Math.abs(custo - product.cost_price) / product.cost_price;
}

// Estoque 50 ou mais costuma ser o número padrão do cadastro (99/100), não o
// real — nesse caso sugere DEFINIR como o que chegou, em vez de somar.
function suggestStock(product: NotaCandidate | undefined, qtd: number): string {
  if (!product || !Number.isFinite(qtd)) return "";
  return fmt(product.stock >= 50 ? qtd : product.stock + qtd);
}

export default function NotaReview({
  data,
  photos,
  storeId,
  onCancel,
  onApplied,
}: {
  data: NotaResult;
  photos: string[];
  storeId: string;
  onCancel: () => void;
  onApplied: () => void;
}) {
  const [rows, setRows] = useState<RowState[]>(() =>
    data.linhas.map((line) => {
      const product = line.candidatos.find((c) => c.id === line.produto_id);
      return {
        productId: line.produto_id,
        qtd: fmt(line.quantidade_real),
        custo: fmt(line.custo_unitario),
        estoque: suggestStock(product, line.quantidade_real),
        include: !!line.produto_id && line.confianca !== "baixa" && !line.divergente && (costJump(product, line.custo_unitario) ?? 0) <= 0.6,
        custoTouched: false,
        estoqueTouched: false,
      };
    }),
  );
  const [showPhotos, setShowPhotos] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ aplicados: number; falhas: string[] } | null>(null);

  function patch(i: number, change: Partial<RowState>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...change } : r)));
  }

  function changeProduct(i: number, productId: string | null) {
    const line = data.linhas[i];
    const product = line.candidatos.find((c) => c.id === productId);
    setRows((prev) =>
      prev.map((r, idx) =>
        idx === i
          ? {
              ...r,
              productId,
              include: !!productId && (costJump(product, num(r.custo)) ?? 0) <= 0.6,
              estoque: r.estoqueTouched ? r.estoque : suggestStock(product, num(r.qtd)),
            }
          : r,
      ),
    );
  }

  function changeQtd(i: number, qtdText: string) {
    const line = data.linhas[i];
    const q = num(qtdText);
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r;
        const product = line.candidatos.find((c) => c.id === r.productId);
        return {
          ...r,
          qtd: qtdText,
          custo: !r.custoTouched && q > 0 ? fmt(Math.round((line.valor_total / q) * 100) / 100) : r.custo,
          estoque: r.estoqueTouched ? r.estoque : suggestStock(product, q),
        };
      }),
    );
  }

  const selected = useMemo(() => rows.filter((r) => r.include && r.productId), [rows]);
  const leftOut = data.linhas.length - selected.length;

  async function apply(repetir = false) {
    setError(null);
    const ids = selected.map((r) => r.productId);
    if (new Set(ids).size !== ids.length) {
      setError("O mesmo produto está marcado em duas linhas. Deixe só uma.");
      return;
    }
    const itens = selected.map((r) => ({ produto_id: r.productId, custo_unitario: num(r.custo), estoque_final: r.estoque.trim() ? num(r.estoque) : null }));
    if (itens.some((it) => !Number.isFinite(it.custo_unitario) || it.custo_unitario < 0 || (it.estoque_final !== null && !Number.isFinite(it.estoque_final)))) {
      setError("Tem custo ou estoque com número inválido. Confira os campos.");
      return;
    }
    setApplying(true);
    try {
      const {
        data: { session },
      } = await getSupabase().auth.getSession();
      if (!session) {
        setError("Sua sessão expirou. Entre de novo.");
        return;
      }
      const res = await fetch("/api/assistente/nota/aplicar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ store_id: storeId, fornecedor: data.nota.fornecedor, numero: data.nota.numero, repetir, itens }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.ja_aplicada) {
        setApplying(false);
        if (window.confirm(`${body.error}

Aplicar mesmo assim?`)) await apply(true);
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "Não deu pra aplicar agora. Tente de novo.");
        return;
      }
      setResult(body);
    } catch {
      setError("Não deu pra aplicar — confira a internet.");
    } finally {
      setApplying(false);
    }
  }

  if (result) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
        <p className="font-semibold">
          Pronto: {result.aplicados} produto{result.aplicados === 1 ? "" : "s"} com custo e estoque atualizados.
        </p>
        {result.falhas.length > 0 && <p className="mt-1">Não consegui atualizar: {result.falhas.join(", ")}.</p>}
        {leftOut > 0 && <p className="mt-1">{leftOut} item(ns) da nota ficaram de fora (não achei no cadastro ou você desmarcou).</p>}
        <button onClick={onApplied} className="mt-3 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white">
          Fechar
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-50">Conferir a nota antes de aplicar</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {data.nota.fornecedor || "Fornecedor não lido"}
            {data.nota.numero ? ` · nota ${data.nota.numero}` : ""} · {data.linhas.length} itens · soma {money(data.nota.soma_itens)}
            {data.nota.total != null ? ` (total da nota ${money(data.nota.total)})` : ""}
          </p>
        </div>
        <button onClick={onCancel} className="shrink-0 text-xs text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300">
          Cancelar
        </button>
      </div>

      {photos.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowPhotos((v) => !v)} className="text-xs font-semibold text-blue-800 underline dark:text-blue-300">
            {showPhotos ? "Esconder a foto da nota" : "Ver a foto da nota (pra comparar)"}
          </button>
          {showPhotos && (
            <div className="mt-2 max-h-96 space-y-2 overflow-auto rounded-lg border border-slate-200 p-1 dark:border-slate-700">
              {photos.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt={`Foto ${i + 1} da nota`} className="w-full" />
              ))}
            </div>
          )}
        </div>
      )}

      {(data.nota.aviso || data.linhas.filter((l) => l.divergente).length >= Math.max(2, data.linhas.length * 0.3)) && (
        <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
          A IA teve dificuldade para ler essa foto. Confira os números com a foto, ou tire outra: nota esticada, de frente, bem iluminada e sem reflexo. Se der, uma foto por página.
        </p>
      )}

      {data.nota.aviso && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">⚠️ {data.nota.aviso}</p>
      )}

      <ul className="mt-3 space-y-3">
        {data.linhas.map((line, i) => {
          const r = rows[i];
          const product = line.candidatos.find((c) => c.id === r.productId);
          const custo = num(r.custo);
          const margin = product && product.price > 0 && Number.isFinite(custo) ? ((product.price - custo) / product.price) * 100 : null;
          const marginColor =
            margin === null ? "" : margin < 10 ? "text-red-600 dark:text-red-400" : margin < 20 ? "text-amber-600 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400";
          return (
            <li key={line.idx} className={`rounded-lg border p-2.5 ${r.include ? "border-slate-300 dark:border-slate-600" : "border-slate-200 opacity-70 dark:border-slate-800"}`}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={r.include}
                  disabled={!r.productId}
                  onChange={(e) => patch(i, { include: e.target.checked })}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">{line.descricao}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {fmt(line.quantidade_nota)} {line.unidade}
                    {line.unidades_por_embalagem > 1 ? ` × ${fmt(line.unidades_por_embalagem)} por embalagem` : ""} · total da linha {money(line.valor_total)}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    !r.productId
                      ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      : line.divergente
                        ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        : line.confianca === "alta"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                  }`}
                >
                  {!r.productId ? "escolha" : line.divergente ? "confira na foto" : line.confianca === "alta" ? "achei" : "confira"}
                </span>
              </label>

              {line.observacao && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{line.observacao}</p>}

              <select
                value={r.productId ?? ""}
                onChange={(e) => changeProduct(i, e.target.value || null)}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                <option value="">— não achei / deixar de fora —</option>
                {line.candidatos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.barcode ?? "sem código"} · {money(c.price)}
                  </option>
                ))}
              </select>

              {product && (
                <>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Hoje: custo {product.cost_price != null ? money(product.cost_price) : "sem custo"} · venda {money(product.price)} · estoque {fmt(product.stock)}
                    {product.stock >= 50 ? " (parece número padrão)" : ""}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <label className="text-xs text-slate-500 dark:text-slate-400">
                      Entram
                      <input
                        inputMode="decimal"
                        value={r.qtd}
                        onChange={(e) => changeQtd(i, e.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                    </label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">
                      Custo cada (R$)
                      <input
                        inputMode="decimal"
                        value={r.custo}
                        onChange={(e) => patch(i, { custo: e.target.value, custoTouched: true })}
                        className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                    </label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">
                      Estoque final
                      <input
                        inputMode="decimal"
                        value={r.estoque}
                        onChange={(e) => patch(i, { estoque: e.target.value, estoqueTouched: true })}
                        className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                    </label>
                  </div>
                  {(costJump(product, custo) ?? 0) > 0.35 && (
                    <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">
                      ⚠️ Custo muito diferente do cadastrado ({product.cost_price != null ? money(product.cost_price) : "—"} → {money(custo)}). Confira se é o mesmo produto e se o número está certo na foto.
                    </p>
                  )}
                  {margin !== null && (
                    <p className={`mt-1 text-xs font-semibold ${marginColor}`}>
                      Margem com esse custo: {margin.toFixed(1).replace(".", ",")}% (lucro {money(product.price - custo)} por unidade)
                    </p>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          O preço de venda não muda.{leftOut > 0 ? ` ${leftOut} item(ns) ficam de fora.` : ""}
        </p>
        <button
          onClick={() => apply()}
          disabled={applying || selected.length === 0}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-50 dark:bg-blue-800"
        >
          {applying ? "Aplicando…" : `Aplicar ${selected.length} produto${selected.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
