"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Neighborhood = {
  id: string;
  name: string;
  fee: number;
  active: boolean;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Bairros() {
  const store = useStore();
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [fee, setFee] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadNeighborhoods() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("neighborhoods")
      .select("id, name, fee, active")
      .eq("store_id", store.id)
      .order("name", { ascending: true });
    setNeighborhoods(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadNeighborhoods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const value = fee.trim() === "" ? 0 : Number(fee.replace(",", "."));
    if (!name.trim() || Number.isNaN(value) || value < 0) {
      setError("Preencha o nome do bairro e um valor de frete válido.");
      return;
    }

    setSaving(true);
    const { error: insertError } = await getSupabase().from("neighborhoods").insert({
      store_id: store.id,
      name: name.trim(),
      fee: value,
    });
    setSaving(false);

    if (insertError) {
      setError("Não deu pra salvar o bairro: " + insertError.message);
      return;
    }

    setName("");
    setFee("");
    loadNeighborhoods();
  }

  async function toggleActive(id: string, active: boolean) {
    setNeighborhoods((prev) => prev.map((n) => (n.id === id ? { ...n, active } : n)));
    await getSupabase().from("neighborhoods").update({ active }).eq("id", id);
  }

  async function deleteNeighborhood(id: string, name: string) {
    if (!window.confirm(`Excluir o bairro "${name}"?`)) return;
    setNeighborhoods((prev) => prev.filter((n) => n.id !== id));
    await getSupabase().from("neighborhoods").delete().eq("id", id);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Frete por bairro</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Cadastre os bairros que você entrega e o valor do frete de cada um. Na hora de fechar o
        pedido, o cliente escolhe o bairro (ou retirar na loja, sem custo) e o frete é somado
        automaticamente.
      </p>

      <form
        onSubmit={handleAdd}
        className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do bairro"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          placeholder="Frete (ex: 5,00)"
          inputMode="decimal"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {saving ? "Salvando…" : "Adicionar bairro"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 font-medium">Bairro</th>
              <th className="px-3 py-2 font-medium">Frete</th>
              <th className="px-3 py-2 font-medium">Ativo</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {loading && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && neighborhoods.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  Nenhum bairro cadastrado ainda. Sem bairros, o cliente só vê a opção de retirar
                  na loja.
                </td>
              </tr>
            )}
            {neighborhoods.map((n) => (
              <tr key={n.id}>
                <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-50">
                  {n.name}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {n.fee > 0 ? formatCurrency(n.fee) : "Grátis"}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => toggleActive(n.id, !n.active)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      n.active
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                        : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {n.active ? "Ativo" : "Inativo"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => deleteNeighborhood(n.id, n.name)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
