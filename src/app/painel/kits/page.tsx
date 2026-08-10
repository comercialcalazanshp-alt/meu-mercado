"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Product = {
  id: string;
  name: string;
};

type KitItem = {
  id: string;
  product_id: string;
  quantity: number;
  products: { name: string } | null;
};

type Kit = {
  id: string;
  name: string;
  image_url: string | null;
  price: number;
  active: boolean;
  kit_items: KitItem[];
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Kits() {
  const store = useStore();
  const [kits, setKits] = useState<Kit[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    const supabase = getSupabase();
    const [{ data: kitsData }, { data: productsData }] = await Promise.all([
      supabase
        .from("kits")
        .select("id, name, image_url, price, active, kit_items(id, product_id, quantity, products(name))")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select("id, name")
        .eq("store_id", store.id)
        .order("name", { ascending: true }),
    ]);
    setKits((kitsData as unknown as Kit[]) ?? []);
    setProducts(productsData ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const value = Number(price.replace(",", "."));
    if (!name.trim() || Number.isNaN(value) || value < 0) {
      setError("Preencha o nome e um preço válido.");
      return;
    }

    setSaving(true);
    const { error: insertError } = await getSupabase().from("kits").insert({
      store_id: store.id,
      name: name.trim(),
      price: value,
      image_url: imageUrl.trim() || null,
    });
    setSaving(false);

    if (insertError) {
      setError("Não deu pra salvar o kit: " + insertError.message);
      return;
    }

    setName("");
    setPrice("");
    setImageUrl("");
    loadAll();
  }

  async function toggleActive(id: string, active: boolean) {
    setKits((prev) => prev.map((k) => (k.id === id ? { ...k, active } : k)));
    await getSupabase().from("kits").update({ active }).eq("id", id);
  }

  async function deleteKit(id: string, kitName: string) {
    if (!window.confirm(`Excluir o kit "${kitName}"?`)) return;
    setKits((prev) => prev.filter((k) => k.id !== id));
    await getSupabase().from("kits").delete().eq("id", id);
  }

  async function addComponent(kitId: string, productId: string, quantity: number) {
    if (!productId || quantity <= 0) return;
    await getSupabase().from("kit_items").insert({
      kit_id: kitId,
      product_id: productId,
      quantity,
    });
    loadAll();
  }

  async function removeComponent(itemId: string) {
    await getSupabase().from("kit_items").delete().eq("id", itemId);
    loadAll();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Kits e combos</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Junte produtos que já existem no seu catálogo num pacote com preço especial.
      </p>

      <form
        onSubmit={handleAdd}
        className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-4"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do kit (ex: Kit churrasco)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 sm:col-span-2"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Preço do kit (R$)"
          inputMode="decimal"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Link da foto (opcional)"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800 sm:col-span-4"
        >
          {saving ? "Salvando…" : "Criar kit"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-6 space-y-4">
        {loading && <p className="text-sm text-slate-500">Carregando…</p>}
        {!loading && kits.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum kit criado ainda.</p>
        )}
        {kits.map((kit) => (
          <div
            key={kit.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-50">
                  {kit.name} — {formatCurrency(kit.price)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleActive(kit.id, !kit.active)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    kit.active
                      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                      : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}
                >
                  {kit.active ? "Ativo" : "Inativo"}
                </button>
                <button
                  onClick={() => deleteKit(kit.id, kit.name)}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Excluir
                </button>
              </div>
            </div>

            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                O que tem dentro
              </p>
              {kit.kit_items.length === 0 && (
                <p className="mt-1 text-sm text-slate-400">Nenhum produto adicionado ainda.</p>
              )}
              <ul className="mt-1 space-y-1">
                {kit.kit_items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300"
                  >
                    <span>
                      {item.quantity}x {item.products?.name ?? "Produto removido"}
                    </span>
                    <button
                      onClick={() => removeComponent(item.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>

              <ComponentForm products={products} onAdd={(productId, qty) => addComponent(kit.id, productId, qty)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComponentForm({
  products,
  onAdd,
}: {
  products: Product[];
  onAdd: (productId: string, quantity: number) => void;
}) {
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
      >
        <option value="">Escolher produto…</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
      />
      <button
        onClick={() => {
          if (!productId) return;
          onAdd(productId, Number(quantity) || 1);
          setProductId("");
          setQuantity("1");
        }}
        className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
      >
        Adicionar produto ao kit
      </button>
    </div>
  );
}
