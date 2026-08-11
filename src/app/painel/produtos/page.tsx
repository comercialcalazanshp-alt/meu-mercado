"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Product = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  cost_price: number | null;
  image_url: string | null;
  stock: number;
  active: boolean;
  promo_buy_qty: number | null;
  promo_pay_qty: number | null;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

function toCsvValue(value: string) {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

export default function Produtos() {
  const store = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [stock, setStock] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [promoDrafts, setPromoDrafts] = useState<Record<string, { buy: string; pay: string }>>({});

  async function loadProducts() {
    setLoading(true);
    const { data } = await getSupabase()
      .from("products")
      .select("id, name, category, price, cost_price, image_url, stock, active, promo_buy_qty, promo_pay_qty")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    setProducts(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const priceValue = Number(price.replace(",", "."));
    const stockValue = Number(stock);
    const costValue = costPrice.trim() ? Number(costPrice.replace(",", ".")) : null;
    if (!name.trim() || Number.isNaN(priceValue) || priceValue < 0) {
      setError("Preencha o nome e um preço válido.");
      return;
    }

    setSaving(true);
    const { error: insertError } = await getSupabase().from("products").insert({
      store_id: store.id,
      name: name.trim(),
      category: category.trim() || null,
      price: priceValue,
      cost_price: costValue !== null && !Number.isNaN(costValue) ? costValue : null,
      stock: Number.isNaN(stockValue) ? 0 : stockValue,
      image_url: imageUrl.trim() || null,
    });
    setSaving(false);

    if (insertError) {
      setError("Não deu pra salvar o produto: " + insertError.message);
      return;
    }

    setName("");
    setCategory("");
    setPrice("");
    setCostPrice("");
    setStock("");
    setImageUrl("");
    loadProducts();
  }

  async function updateProduct(id: string, patch: Partial<Product>) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    await getSupabase().from("products").update(patch).eq("id", id);
  }

  function promoDraftFor(p: Product) {
    return (
      promoDrafts[p.id] ?? {
        buy: p.promo_buy_qty ? String(p.promo_buy_qty) : "",
        pay: p.promo_pay_qty ? String(p.promo_pay_qty) : "",
      }
    );
  }

  async function handleSavePromo(p: Product) {
    const draft = promoDraftFor(p);
    const buy = draft.buy.trim() ? Number(draft.buy) : null;
    const pay = draft.pay.trim() ? Number(draft.pay) : null;

    if (buy === null && pay === null) {
      await updateProduct(p.id, { promo_buy_qty: null, promo_pay_qty: null });
      setPromoDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      return;
    }

    if (!buy || !pay || buy <= pay) {
      window.alert('Preencha "Leve" e "Pague" com números válidos, sendo "Leve" maior que "Pague".');
      return;
    }

    await updateProduct(p.id, { promo_buy_qty: buy, promo_pay_qty: pay });
    setPromoDrafts((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
  }

  async function deleteProduct(id: string, productName: string) {
    if (!window.confirm(`Excluir "${productName}"? Essa ação não pode ser desfeita.`)) return;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    await getSupabase().from("products").delete().eq("id", id);
  }

  function exportCsv() {
    const header = ["nome", "categoria", "preco", "estoque", "preco_custo"];
    const lines = [header.join(",")];
    for (const p of products) {
      lines.push(
        [
          toCsvValue(p.name),
          toCsvValue(p.category ?? ""),
          String(p.price),
          String(p.stock),
          p.cost_price !== null ? String(p.cost_price) : "",
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `produtos-${store.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImporting(true);
    setImportMessage(null);
    setError(null);

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      setImporting(false);
      setError("O arquivo CSV está vazio.");
      return;
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {
      name: header.indexOf("nome"),
      category: header.indexOf("categoria"),
      price: header.indexOf("preco"),
      stock: header.indexOf("estoque"),
      costPrice: header.indexOf("preco_custo"),
    };

    if (idx.name === -1 || idx.price === -1) {
      setImporting(false);
      setError('CSV precisa ter pelo menos as colunas "nome" e "preco".');
      return;
    }

    const supabase = getSupabase();
    const existingByName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows.slice(1)) {
      const rowName = (row[idx.name] ?? "").trim();
      const priceValue = Number((row[idx.price] ?? "").replace(",", "."));
      if (!rowName || Number.isNaN(priceValue) || priceValue < 0) {
        skipped++;
        continue;
      }

      const stockRaw = idx.stock !== -1 ? (row[idx.stock] ?? "").trim() : "";
      const stockValue = stockRaw ? Number(stockRaw) : undefined;
      const costRaw = idx.costPrice !== -1 ? (row[idx.costPrice] ?? "").trim() : "";
      const costValue = costRaw ? Number(costRaw.replace(",", ".")) : undefined;
      const categoryValue = idx.category !== -1 ? (row[idx.category] ?? "").trim() : "";

      const existing = existingByName.get(rowName.toLowerCase());
      if (existing) {
        const patch: Record<string, unknown> = { price: priceValue };
        if (stockValue !== undefined && !Number.isNaN(stockValue)) patch.stock = stockValue;
        if (costValue !== undefined && !Number.isNaN(costValue)) patch.cost_price = costValue;
        if (categoryValue) patch.category = categoryValue;
        await supabase.from("products").update(patch).eq("id", existing.id);
        updated++;
      } else {
        await supabase.from("products").insert({
          store_id: store.id,
          name: rowName,
          category: categoryValue || null,
          price: priceValue,
          stock: stockValue !== undefined && !Number.isNaN(stockValue) ? stockValue : 0,
          cost_price: costValue !== undefined && !Number.isNaN(costValue) ? costValue : null,
        });
        created++;
      }
    }

    setImporting(false);
    setImportMessage(
      `Importação concluída: ${created} produto${created === 1 ? "" : "s"} criado${created === 1 ? "" : "s"}, ${updated} atualizado${updated === 1 ? "" : "s"}${skipped > 0 ? `, ${skipped} linha${skipped === 1 ? "" : "s"} ignorada${skipped === 1 ? "" : "s"} (sem nome ou preço válido)` : ""}.`,
    );
    loadProducts();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Produtos</h1>

      <form
        onSubmit={handleAdd}
        className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-6"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do produto"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 lg:col-span-2"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Categoria"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Preço (R$)"
          inputMode="decimal"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={costPrice}
          onChange={(e) => setCostPrice(e.target.value)}
          placeholder="Custo (opcional)"
          inputMode="decimal"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          placeholder="Estoque"
          inputMode="numeric"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Link da foto (opcional)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 sm:col-span-2 lg:col-span-5"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {saving ? "Salvando…" : "Adicionar produto"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={exportCsv}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
        >
          Exportar CSV
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
        >
          {importing ? "Importando…" : "Importar CSV"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleImportFile}
          className="hidden"
        />
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Colunas: nome, categoria, preco, estoque, preco_custo — produto existente (mesmo nome) é atualizado, o resto é criado.
        </span>
      </div>
      {importMessage && <p className="mt-2 text-sm text-green-700 dark:text-green-400">{importMessage}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Preço</th>
              <th className="px-3 py-2 font-medium">Custo</th>
              <th className="px-3 py-2 font-medium">Margem</th>
              <th className="px-3 py-2 font-medium">Estoque</th>
              <th className="px-3 py-2 font-medium">Promoção (leve/pague)</th>
              <th className="px-3 py-2 font-medium">Ativo</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {loading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && products.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  Nenhum produto cadastrado ainda.
                </td>
              </tr>
            )}
            {products.map((p) => {
              const margin = p.cost_price && p.price > 0 ? ((p.price - p.cost_price) / p.price) * 100 : null;
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2 text-slate-900 dark:text-slate-50">{p.name}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{p.category || "—"}</td>
                  <td className="px-3 py-2">
                    <input
                      key={`price-${p.id}-${p.price}`}
                      type="number"
                      step="0.01"
                      defaultValue={p.price}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v) && v >= 0) updateProduct(p.id, { price: v });
                      }}
                      className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      key={`cost-${p.id}-${p.cost_price}`}
                      type="number"
                      step="0.01"
                      defaultValue={p.cost_price ?? ""}
                      placeholder="—"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const v = raw ? Number(raw) : null;
                        if (v === null || (!Number.isNaN(v) && v >= 0)) updateProduct(p.id, { cost_price: v });
                      }}
                      className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {margin !== null ? `${margin.toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      key={`stock-${p.id}-${p.stock}`}
                      type="number"
                      defaultValue={p.stock}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v) && v >= 0) updateProduct(p.id, { stock: v });
                      }}
                      className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        placeholder="Leve"
                        value={promoDraftFor(p).buy}
                        onChange={(e) =>
                          setPromoDrafts((prev) => ({
                            ...prev,
                            [p.id]: { ...promoDraftFor(p), buy: e.target.value },
                          }))
                        }
                        className="w-14 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                      <input
                        type="number"
                        min={1}
                        placeholder="Pague"
                        value={promoDraftFor(p).pay}
                        onChange={(e) =>
                          setPromoDrafts((prev) => ({
                            ...prev,
                            [p.id]: { ...promoDraftFor(p), pay: e.target.value },
                          }))
                        }
                        className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                      <button
                        onClick={() => handleSavePromo(p)}
                        className="text-xs font-medium text-blue-900 hover:underline dark:text-blue-400"
                      >
                        Salvar
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => updateProduct(p.id, { active: !p.active })}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        p.active
                          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                          : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {p.active ? "Ativo" : "Inativo"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => deleteProduct(p.id, p.name)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
