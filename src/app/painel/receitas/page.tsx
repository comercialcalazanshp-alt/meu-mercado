"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type ProductOption = {
  id: string;
  name: string;
};

type Ingredient = {
  id: string;
  qty: number;
};

type Recipe = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  image_url: string | null;
  ingredients: Ingredient[];
  featured: boolean;
  created_at: string;
};

function resizeImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxSize = 900;
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas não disponível"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar imagem"))),
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não deu pra abrir a imagem"));
    };
    img.src = url;
  });
}

export default function Receitas() {
  const store = useStore();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [selectedItems, setSelectedItems] = useState<Ingredient[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const supabase = getSupabase();
    const [{ data: recipeData }, { data: productData }] = await Promise.all([
      supabase
        .from("recipes")
        .select("id, name, description, instructions, image_url, ingredients, featured, created_at")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
      supabase.from("products").select("id, name").eq("store_id", store.id).eq("active", true).order("name"),
    ]);
    setRecipes((recipeData ?? []) as Recipe[]);
    setProducts((productData ?? []) as ProductOption[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const productMatches = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 15);
  }, [productSearch, products]);

  function openNewForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setInstructions("");
    setImageUrl("");
    setProductSearch("");
    setSelectedItems([]);
    setError("");
    setFormOpen(true);
  }

  function openEditForm(r: Recipe) {
    setEditingId(r.id);
    setName(r.name);
    setDescription(r.description ?? "");
    setInstructions(r.instructions ?? "");
    setImageUrl(r.image_url ?? "");
    setProductSearch("");
    setSelectedItems(r.ingredients.map((it) => ({ ...it })));
    setError("");
    setFormOpen(true);
  }

  function addIngredient(productId: string) {
    setSelectedItems((prev) =>
      prev.some((it) => it.id === productId) ? prev : [...prev, { id: productId, qty: 1 }],
    );
  }

  function removeIngredient(productId: string) {
    setSelectedItems((prev) => prev.filter((it) => it.id !== productId));
  }

  function setIngredientQty(productId: string, qty: number) {
    setSelectedItems((prev) =>
      prev.map((it) => (it.id === productId ? { ...it, qty: Math.max(1, qty || 1) } : it)),
    );
  }

  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingPhoto(true);
    const blob = await resizeImage(file);
    const path = `${store.id}/receita-${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await getSupabase()
      .storage.from("product-images")
      .upload(path, blob, { contentType: "image/jpeg" });
    setUploadingPhoto(false);
    if (uploadError) {
      setError("Não deu pra enviar a foto: " + uploadError.message);
      return;
    }
    const { data } = getSupabase().storage.from("product-images").getPublicUrl(path);
    setImageUrl(data.publicUrl);
  }

  async function handleSave() {
    setError("");
    if (!name.trim()) {
      setError("Digite o nome da receita.");
      return;
    }
    if (selectedItems.length === 0) {
      setError("Adicione pelo menos um ingrediente.");
      return;
    }
    setSaving(true);
    const supabase = getSupabase();
    const payload = {
      store_id: store.id,
      name: name.trim(),
      description: description.trim() || null,
      instructions: instructions.trim() || null,
      image_url: imageUrl || null,
      ingredients: selectedItems,
    };
    const { error: saveError } = editingId
      ? await supabase.from("recipes").update(payload).eq("id", editingId)
      : await supabase.from("recipes").insert({ ...payload, featured: false });
    setSaving(false);
    if (saveError) {
      setError("Não deu pra salvar: " + saveError.message);
      return;
    }
    setFormOpen(false);
    load();
  }

  async function toggleFeatured(r: Recipe) {
    const supabase = getSupabase();
    if (!r.featured) {
      await supabase.from("recipes").update({ featured: false }).eq("store_id", store.id).eq("featured", true);
    }
    await supabase.from("recipes").update({ featured: !r.featured }).eq("id", r.id);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir essa receita? Não dá pra desfazer.")) return;
    await getSupabase().from("recipes").delete().eq("id", id);
    load();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Receitas</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Receita com produtos que você vende — o cliente vê no site e adiciona os ingredientes no
            carrinho com 1 clique. Marque uma como &quot;destaque&quot; pra ela virar a receita da semana
            na home.
          </p>
        </div>
        <button
          onClick={openNewForm}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 dark:bg-blue-800"
        >
          + Nova receita
        </button>
      </div>

      {products.length === 0 && !loading && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Você ainda não tem produtos cadastrados — a receita sempre gira em torno de produtos do seu
          catálogo.
        </p>
      )}

      {formOpen && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Nome da receita
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex: Bolo de fubá"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />

          <label className="mb-1 mt-3 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Descrição curta (aparece no card)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="ex: Simples, rápido e uma delícia"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />

          <label className="mb-1 mt-3 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Foto da receita
          </label>
          <div className="flex items-center gap-3">
            <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
              {uploadingPhoto ? "Enviando…" : "📷 Escolher foto"}
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </label>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
            )}
          </div>

          <label className="mb-1 mt-3 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Modo de preparo
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            placeholder="Passo a passo"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />

          <label className="mb-1 mt-3 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Buscar produtos pra adicionar como ingrediente
          </label>
          <input
            type="text"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Digite pra buscar..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          {productSearch.trim() !== "" && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {productMatches.length === 0 && (
                <p className="text-sm text-slate-500">Nenhum produto encontrado.</p>
              )}
              {productMatches.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-1">
                  <span className="text-sm text-slate-700 dark:text-slate-300">{p.name}</span>
                  <button
                    onClick={() => addIngredient(p.id)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  >
                    + Adicionar
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="mb-1 mt-3 text-xs font-medium text-slate-600 dark:text-slate-400">Ingredientes:</p>
          {selectedItems.length === 0 && <p className="text-sm text-slate-500">Nenhum ingrediente ainda.</p>}
          {selectedItems.map((it) => {
            const product = products.find((p) => p.id === it.id);
            return (
              <div key={it.id} className="flex items-center justify-between gap-2 py-1">
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">
                  {product ? product.name : "(produto removido)"}
                </span>
                <input
                  type="number"
                  min={1}
                  value={it.qty}
                  onChange={(e) => setIngredientQty(it.id, Number(e.target.value))}
                  className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <button
                  onClick={() => removeIngredient(it.id)}
                  className="text-sm font-medium text-red-600 dark:text-red-400"
                >
                  remover
                </button>
              </div>
            );
          })}

          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
            >
              {saving ? "Salvando…" : "Salvar receita"}
            </button>
            <button
              onClick={() => setFormOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading && <p className="mt-6 text-sm text-slate-500">Carregando…</p>}
      {!loading && recipes.length === 0 && <p className="mt-6 text-sm text-slate-500">Nenhuma receita cadastrada ainda.</p>}

      <div className="mt-4 flex flex-col gap-3">
        {recipes.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start gap-3">
              {r.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.image_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
              )}
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-50">
                  {r.name}
                  {r.featured && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      receita da semana
                    </span>
                  )}
                </p>
                {r.description && (
                  <p className="text-sm text-slate-600 dark:text-slate-400">{r.description}</p>
                )}
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                  {r.ingredients.length} ingrediente{r.ingredients.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => toggleFeatured(r)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                {r.featured ? "Remover destaque" : "Destacar"}
              </button>
              <button
                onClick={() => openEditForm(r)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Editar
              </button>
              <button
                onClick={() => handleDelete(r.id)}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 dark:border-red-900 dark:text-red-400"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
