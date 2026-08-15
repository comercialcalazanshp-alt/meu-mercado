"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import PhotoField from "@/components/PhotoField";

type Product = {
  id: string;
  name: string;
  price: number;
  cost_price: number | null;
  stock: number;
  sold_by_weight: boolean;
  image_url: string | null;
};

type KitItem = {
  id: string;
  product_id: string;
  quantity: number;
  products: Product | null;
};

type Kit = {
  id: string;
  name: string;
  image_url: string | null;
  price: number;
  active: boolean;
  category: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  kit_items: KitItem[];
};

type KitStat = {
  units_sold_recent: number;
  revenue_recent: number;
  profit_recent: number | null;
  avg_daily_sales: number;
  last_sold_at: string | null;
};

type SuggestedPair = {
  product_a_id: string;
  product_a_name: string;
  product_b_id: string;
  product_b_name: string;
  times_bought_together: number;
};

const KIT_TEMPLATES = [
  "Kit churrasco",
  "Kit café da manhã",
  "Kit limpeza",
  "Kit lanche",
  "Cesta básica",
  "Kit festa",
];

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function daysSince(dateIso: string): number {
  return Math.round((Date.now() - new Date(dateIso).getTime()) / 86400000);
}

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
  // Mesmo cuidado do CSV de produtos/pedidos: evita que um valor tipo
  // "=algo" vire fórmula ativa ao abrir o arquivo no Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  if (/[",\n]/.test(safe)) return '"' + safe.replace(/"/g, '""') + '"';
  return safe;
}

function KitPriceHistoryChart({ kitId }: { kitId: string }) {
  const [history, setHistory] = useState<{ price: number; changed_at: string }[] | null>(null);

  useEffect(() => {
    let active = true;
    getSupabase()
      .from("kit_price_history")
      .select("price, changed_at")
      .eq("kit_id", kitId)
      .order("changed_at", { ascending: true })
      .then(({ data }) => {
        if (active) setHistory(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [kitId]);

  if (history === null) return <p className="text-xs text-slate-400">Carregando histórico…</p>;
  if (history.length <= 1) return <p className="text-xs text-slate-400">Ainda não teve mudança de preço registrada.</p>;

  const prices = history.map((h) => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const width = 280;
  const height = 56;
  const padX = 6;
  const padY = 8;
  const points = history.map((h, i) => ({
    x: padX + (i / (history.length - 1)) * (width - padX * 2),
    y: height - padY - ((h.price - min) / range) * (height - padY * 2),
    price: h.price,
    date: h.changed_at,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full max-w-xs text-blue-900 dark:text-blue-400">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="currentColor">
            <title>
              {new Date(p.date).toLocaleDateString("pt-BR")} — {formatCurrency(p.price)}
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
        {history.map((h, i) => (
          <span key={i}>
            {new Date(h.changed_at).toLocaleDateString("pt-BR")}: {formatCurrency(h.price)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Kits() {
  const store = useStore();
  const [kits, setKits] = useState<Kit[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, KitStat>>({});
  const [suggestions, setSuggestions] = useState<SuggestedPair[]>([]);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadAll() {
    setLoading(true);
    const supabase = getSupabase();
    const [{ data: kitsData }, { data: productsData }, { data: statsData }, { data: suggestData }] = await Promise.all([
      supabase
        .from("kits")
        .select(
          "id, name, image_url, price, active, category, starts_at, ends_at, created_at, kit_items(id, product_id, quantity, products(id, name, price, cost_price, stock, sold_by_weight, image_url))",
        )
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select("id, name, price, cost_price, stock, sold_by_weight, image_url")
        .eq("store_id", store.id)
        .order("name", { ascending: true }),
      supabase.rpc("kit_sales_stats", { p_store_id: store.id }),
      supabase.rpc("suggest_kit_pairs", { p_store_id: store.id }),
    ]);
    setKits((kitsData as unknown as Kit[]) ?? []);
    setProducts(productsData ?? []);
    const statMap: Record<string, KitStat> = {};
    for (const s of (statsData as (KitStat & { kit_id: string })[]) ?? []) statMap[s.kit_id] = s;
    setStats(statMap);
    setSuggestions((suggestData as SuggestedPair[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const k of kits) if (k.category) set.add(k.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [kits]);

  const filteredKits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return kits;
    return kits.filter((k) => k.name.toLowerCase().includes(q) || (k.category && k.category.toLowerCase().includes(q)));
  }, [kits, search]);

  function buildDefaultPrompt(kitName: string, productNames: string[]) {
    const itemsList = productNames.filter((n) => n.trim()).join(", ");
    return [
      `Foto de produto realista, estilo comercial de supermercado, mostrando um kit/cesta chamado "${kitName.trim() || "kit"}".`,
      itemsList ? `Contém: ${itemsList}.` : "",
      "Itens organizados de forma atraente, fundo neutro claro, iluminação de estúdio, sem texto, sem logotipos, sem marcas d'água.",
    ]
      .filter(Boolean)
      .join(" ");
  }

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
      category: category.trim() || null,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    });
    setSaving(false);

    if (insertError) {
      setError("Não deu pra salvar o kit: " + insertError.message);
      return;
    }

    setName("");
    setPrice("");
    setCategory("");
    setImageUrl("");
    setStartsAt("");
    setEndsAt("");
    loadAll();
  }

  async function updateKit(id: string, patch: Partial<Pick<Kit, "name" | "price" | "category" | "active" | "starts_at" | "ends_at" | "image_url">>) {
    setKits((prev) => prev.map((k) => (k.id === id ? { ...k, ...patch } : k)));
    const { error: updateError } = await getSupabase().from("kits").update(patch).eq("id", id);
    if (updateError) setError("Não deu pra atualizar: " + updateError.message);
  }

  async function toggleActive(id: string, active: boolean) {
    await updateKit(id, { active });
  }

  async function deleteKit(id: string, kitName: string) {
    if (!window.confirm(`Excluir o kit "${kitName}"?`)) return;
    setKits((prev) => prev.filter((k) => k.id !== id));
    await getSupabase().from("kits").delete().eq("id", id);
  }

  async function handleDuplicate(kit: Kit) {
    setDuplicating(kit.id);
    const { data: newKit, error: insertError } = await getSupabase()
      .from("kits")
      .insert({
        store_id: store.id,
        name: `${kit.name} (cópia)`,
        price: kit.price,
        image_url: kit.image_url,
        category: kit.category,
        starts_at: kit.starts_at,
        ends_at: kit.ends_at,
      })
      .select("id")
      .single();

    if (insertError || !newKit) {
      setDuplicating(null);
      setError("Não deu pra duplicar: " + (insertError?.message ?? ""));
      return;
    }

    if (kit.kit_items.length > 0) {
      await getSupabase()
        .from("kit_items")
        .insert(kit.kit_items.map((item) => ({ kit_id: newKit.id, product_id: item.product_id, quantity: item.quantity })));
    }

    setDuplicating(null);
    loadAll();
  }

  async function addComponent(kitId: string, productId: string, quantity: number) {
    if (!productId || quantity <= 0) return;
    await getSupabase().from("kit_items").insert({ kit_id: kitId, product_id: productId, quantity });
    loadAll();
  }

  async function removeComponent(itemId: string, productName: string) {
    if (!window.confirm(`Remover "${productName}" desse kit?`)) return;
    await getSupabase().from("kit_items").delete().eq("id", itemId);
    loadAll();
  }

  async function createKitFromSuggestion(pair: SuggestedPair) {
    const a = products.find((p) => p.id === pair.product_a_id);
    const b = products.find((p) => p.id === pair.product_b_id);
    if (!a || !b) return;
    const suggestedPrice = Math.round((a.price + b.price) * 0.95 * 100) / 100;
    const { data: newKit, error: insertError } = await getSupabase()
      .from("kits")
      .insert({ store_id: store.id, name: `${a.name} + ${b.name}`, price: suggestedPrice })
      .select("id")
      .single();
    if (insertError || !newKit) {
      setError("Não deu pra criar o kit: " + (insertError?.message ?? ""));
      return;
    }
    await getSupabase()
      .from("kit_items")
      .insert([
        { kit_id: newKit.id, product_id: a.id, quantity: 1 },
        { kit_id: newKit.id, product_id: b.id, quantity: 1 },
      ]);
    loadAll();
  }

  function printKitLabels(list: Kit[]) {
    if (list.length === 0) return;
    const labels = list
      .map(
        (k) => `
        <div class="label">
          <p class="name">${k.name}</p>
          <p class="price">${formatCurrency(k.price)}</p>
        </div>`,
      )
      .join("");
    const win = window.open("", "_blank", "width=380,height=600");
    if (!win) return;
    win.document.write(`
      <html><head><title>Etiquetas de kit</title>
      <style>
        @page { size: 58mm auto; margin: 1.5mm; }
        * { box-sizing: border-box; }
        body{font-family:sans-serif;margin:0;padding:0;}
        .label{width:55mm;text-align:center;padding:2mm 3mm;page-break-after:always;break-after:page;}
        .label:last-child{page-break-after:auto;break-after:auto;}
        .name{font-size:14px;font-weight:600;margin:0 0 1.5mm;}
        .price{font-size:24px;font-weight:bold;margin:1mm 0;}
      </style></head><body>
      ${labels}
      <script>window.print();</script>
      </body></html>
    `);
    win.document.close();
  }

  const CSV_HEADER = ["nome", "preco", "categoria", "ativo", "inicio", "fim", "componentes"];

  function exportCsv() {
    const lines = [CSV_HEADER.join(",")];
    for (const k of kits) {
      const componentes = k.kit_items.map((i) => `${i.products?.name ?? ""}:${i.quantity}`).join("|");
      lines.push(
        [
          toCsvValue(k.name),
          String(k.price),
          toCsvValue(k.category ?? ""),
          k.active ? "sim" : "nao",
          k.starts_at ? k.starts_at.slice(0, 10) : "",
          k.ends_at ? k.ends_at.slice(0, 10) : "",
          toCsvValue(componentes),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kits-${store.slug}.csv`;
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
      price: header.indexOf("preco"),
      category: header.indexOf("categoria"),
      active: header.indexOf("ativo"),
      starts: header.indexOf("inicio"),
      ends: header.indexOf("fim"),
      components: header.indexOf("componentes"),
    };

    if (idx.name === -1 || idx.price === -1) {
      setImporting(false);
      setError('CSV precisa ter pelo menos as colunas "nome" e "preco".');
      return;
    }

    const supabase = getSupabase();
    const productByName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
    const existingByName = new Map(kits.map((k) => [k.name.trim().toLowerCase(), k]));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowName = (row[idx.name] ?? "").trim();
      const rowPriceRaw = (row[idx.price] ?? "").trim();
      if (!rowName || !rowPriceRaw) {
        skipped++;
        continue;
      }
      const rowPrice = Number(rowPriceRaw.replace(",", "."));
      if (Number.isNaN(rowPrice)) {
        skipped++;
        continue;
      }

      const patch: Record<string, unknown> = { name: rowName, price: rowPrice };
      if (idx.category !== -1) patch.category = (row[idx.category] ?? "").trim() || null;
      if (idx.active !== -1) patch.active = (row[idx.active] ?? "").trim().toLowerCase() !== "nao";
      if (idx.starts !== -1) {
        const raw = (row[idx.starts] ?? "").trim();
        patch.starts_at = raw ? new Date(raw + "T00:00:00").toISOString() : null;
      }
      if (idx.ends !== -1) {
        const raw = (row[idx.ends] ?? "").trim();
        patch.ends_at = raw ? new Date(raw + "T23:59:59").toISOString() : null;
      }

      const existing = existingByName.get(rowName.toLowerCase());
      let kitId: string;
      if (existing) {
        await supabase.from("kits").update(patch).eq("id", existing.id);
        kitId = existing.id;
        updated++;
      } else {
        const { data: newKit, error: insertError } = await supabase
          .from("kits")
          .insert({ store_id: store.id, ...patch })
          .select("id")
          .single();
        if (insertError || !newKit) {
          skipped++;
          continue;
        }
        kitId = newKit.id;
        created++;
      }

      if (idx.components !== -1) {
        const raw = (row[idx.components] ?? "").trim();
        await supabase.from("kit_items").delete().eq("kit_id", kitId);
        if (raw) {
          const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
          const toInsert: { kit_id: string; product_id: string; quantity: number }[] = [];
          for (const part of parts) {
            const [prodName, qtyRaw] = part.split(":").map((s) => s.trim());
            const product = productByName.get((prodName ?? "").toLowerCase());
            const qty = Number((qtyRaw ?? "1").replace(",", "."));
            if (product && qty > 0) toInsert.push({ kit_id: kitId, product_id: product.id, quantity: qty });
          }
          if (toInsert.length > 0) await supabase.from("kit_items").insert(toInsert);
        }
      }
    }

    setImporting(false);
    setImportMessage(`Pronto: ${created} kit(s) criado(s), ${updated} atualizado(s)${skipped > 0 ? `, ${skipped} ignorado(s)` : ""}.`);
    loadAll();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Kits e combos</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Junte produtos que já existem no seu catálogo num pacote com preço especial.
      </p>

      {suggestions.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/10">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">💡 Sugestão de kit</p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-400">
            Esses produtos são comprados juntos com frequência — que tal montar um kit?
          </p>
          <div className="mt-2 space-y-1">
            {suggestions.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-700 dark:text-slate-300">
                  {s.product_a_name} + {s.product_b_name}{" "}
                  <span className="text-xs text-slate-400">({s.times_bought_together}x juntos)</span>
                </span>
                <button
                  onClick={() => createKitFromSuggestion(s)}
                  className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300"
                >
                  Criar kit com esses 2
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {KIT_TEMPLATES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setName(t)}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            {t}
          </button>
        ))}
      </div>

      <form onSubmit={handleAdd} className="mt-2 space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Nome do kit</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Kit churrasco"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Categoria (opcional)</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ex: Churrasco"
              list="categorias-kit"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
            <datalist id="categorias-kit">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Preço do kit (R$)</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="R$"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Começa em (opcional)</label>
            <input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Termina em (opcional)</label>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Foto</p>
          <div className="mt-2">
            <PhotoField
              storeId={store.id}
              value={imageUrl}
              onChange={setImageUrl}
              uploadPrefix="kit"
              promptSeed={buildDefaultPrompt(name, [])}
              catalogProducts={products}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {saving ? "Salvando…" : "Criar kit"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar kit por nome ou categoria…"
          className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <div className="flex items-center gap-3">
          <button onClick={exportCsv} className="text-sm font-medium text-blue-900 underline dark:text-blue-400">
            Exportar CSV
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="text-sm font-medium text-blue-900 underline disabled:opacity-60 dark:text-blue-400"
          >
            {importing ? "Importando…" : "Importar CSV"}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleImportFile} className="hidden" />
        </div>
      </div>
      {importMessage && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{importMessage}</p>}
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
        Colunas do CSV: nome, preco, categoria, ativo (sim/nao), inicio, fim, componentes (formato &quot;produto:qtd|produto:qtd&quot;).
      </p>

      {(() => {
        const ranked = kits
          .filter((k) => (stats[k.id]?.units_sold_recent ?? 0) > 0)
          .sort((a, b) => (stats[b.id]?.units_sold_recent ?? 0) - (stats[a.id]?.units_sold_recent ?? 0))
          .slice(0, 5);
        if (ranked.length === 0) return null;
        return (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              🏆 Ranking de kits (últimos 30 dias)
            </p>
            <ol className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              {ranked.map((k, i) => (
                <li key={k.id} className="flex justify-between">
                  <span>
                    {i + 1}. {k.name}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {stats[k.id]?.units_sold_recent} vendido(s) · {formatCurrency(stats[k.id]?.revenue_recent ?? 0)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        );
      })()}

      <div className="mt-6 space-y-4">
        {loading && <p className="text-sm text-slate-500">Carregando…</p>}
        {!loading && filteredKits.length === 0 && (
          <p className="text-sm text-slate-500">{kits.length === 0 ? "Nenhum kit criado ainda." : "Nenhum kit encontrado pra essa busca."}</p>
        )}
        {filteredKits.map((kit) => {
          const componentsTotal = kit.kit_items.reduce((sum, i) => sum + i.quantity * (i.products?.price ?? 0), 0);
          const componentsCost =
            kit.kit_items.length > 0 && kit.kit_items.every((i) => i.products?.cost_price !== null && i.products?.cost_price !== undefined)
              ? kit.kit_items.reduce((sum, i) => sum + i.quantity * (i.products?.cost_price ?? 0), 0)
              : null;
          const margin = componentsCost !== null && kit.price > 0 ? ((kit.price - componentsCost) / kit.price) * 100 : null;
          const markup = componentsCost !== null && componentsCost > 0 ? ((kit.price - componentsCost) / componentsCost) * 100 : null;
          const savings = componentsTotal - kit.price;
          const priceIncoherent = kit.kit_items.length > 0 && kit.price >= componentsTotal;
          const outOfStockComponent = kit.kit_items.find((i) => (i.products?.stock ?? 0) <= 0);
          const buildable =
            kit.kit_items.length > 0
              ? Math.min(...kit.kit_items.map((i) => Math.floor((i.products?.stock ?? 0) / i.quantity)))
              : null;
          const stat = stats[kit.id];
          const isStalled = stat && stat.last_sold_at && daysSince(stat.last_sold_at) > 30;
          const neverSold = stat && !stat.last_sold_at;
          const isNew = daysSince(kit.created_at) <= 7;

          return (
            <div key={kit.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {kit.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={kit.image_url} alt={kit.name} className="h-14 w-14 rounded-lg object-cover" />
                  ) : (
                    <div className="h-14 w-14 rounded-lg bg-slate-200 dark:bg-slate-700" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <input
                        key={`name-${kit.id}-${kit.name}`}
                        defaultValue={kit.name}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== kit.name && updateKit(kit.id, { name: e.target.value.trim() })}
                        className="rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-slate-900 hover:border-slate-300 focus:border-slate-300 dark:text-slate-50 dark:hover:border-slate-700"
                      />
                      {isNew && (
                        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                          🆕 novo
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <span>R$</span>
                      <input
                        key={`price-${kit.id}-${kit.price}`}
                        type="number"
                        step="0.01"
                        defaultValue={kit.price}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isNaN(v) && v >= 0) updateKit(kit.id, { price: v });
                        }}
                        className="w-20 rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
                      />
                      <input
                        key={`cat-${kit.id}-${kit.category}`}
                        defaultValue={kit.category ?? ""}
                        placeholder="categoria"
                        list="categorias-kit"
                        onBlur={(e) => updateKit(kit.id, { category: e.target.value.trim() || null })}
                        className="w-28 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                  </div>
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
                    onClick={() => setExpandedId(expandedId === kit.id ? null : kit.id)}
                    className="text-xs font-medium text-blue-900 hover:underline dark:text-blue-400"
                  >
                    {expandedId === kit.id ? "Fechar" : "Detalhes"}
                  </button>
                  <button onClick={() => deleteKit(kit.id, kit.name)} className="text-xs font-medium text-red-600 hover:underline">
                    Excluir
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => printKitLabels([kit])} className="text-xs font-medium text-blue-900 hover:underline dark:text-blue-400">
                  🏷️ Etiqueta
                </button>
                <button
                  onClick={() => handleDuplicate(kit)}
                  disabled={duplicating === kit.id}
                  className="text-xs font-medium text-blue-900 hover:underline disabled:opacity-60 dark:text-blue-400"
                >
                  {duplicating === kit.id ? "duplicando…" : "📋 Duplicar"}
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {margin !== null && (
                  <span className={margin < 10 ? "font-medium text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}>
                    margem {margin.toFixed(0)}% · markup {markup !== null ? `${markup.toFixed(0)}%` : "—"}
                  </span>
                )}
                {componentsCost !== null && kit.price <= componentsCost && (
                  <span className="font-semibold text-red-600 dark:text-red-400">⚠️ no prejuízo</span>
                )}
                {kit.kit_items.length > 0 && !priceIncoherent && savings > 0 && (
                  <span className="text-green-700 dark:text-green-400">✅ cliente economiza {formatCurrency(savings)}</span>
                )}
                {priceIncoherent && (
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    ⚠️ preço do kit não é mais barato que comprar os produtos separados
                  </span>
                )}
                {outOfStockComponent && (
                  <span className="font-medium text-red-600 dark:text-red-400">
                    ⚠️ &quot;{outOfStockComponent.products?.name}&quot; sem estoque — kit não pode ser vendido
                  </span>
                )}
                {buildable !== null && !outOfStockComponent && (
                  <span className="text-slate-500 dark:text-slate-400">📦 dá pra montar mais {buildable} kit(s) agora</span>
                )}
                {isStalled && <span className="text-slate-500 dark:text-slate-400">😴 parado há {daysSince(stat!.last_sold_at!)}d</span>}
                {neverSold && !isNew && <span className="text-slate-500 dark:text-slate-400">😴 nunca vendeu</span>}
                {(kit.starts_at || kit.ends_at) && (
                  <span className="text-slate-500 dark:text-slate-400">
                    🗓️ {kit.starts_at ? new Date(kit.starts_at).toLocaleDateString("pt-BR") : "sempre"}
                    {" → "}
                    {kit.ends_at ? new Date(kit.ends_at).toLocaleDateString("pt-BR") : "sem fim"}
                  </span>
                )}
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">O que tem dentro</p>
                {kit.kit_items.length === 0 && <p className="mt-1 text-sm text-slate-400">Nenhum produto adicionado ainda.</p>}
                <ul className="mt-1 space-y-1">
                  {kit.kit_items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                      <span>
                        {item.quantity}
                        {item.products?.sold_by_weight ? "kg" : "x"} {item.products?.name ?? "Produto removido"}
                        {(item.products?.stock ?? 0) <= 0 && <span className="ml-1 text-xs text-red-600 dark:text-red-400">(sem estoque)</span>}
                      </span>
                      <button
                        onClick={() => removeComponent(item.id, item.products?.name ?? "esse produto")}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>

                <ComponentForm products={products} onAdd={(productId, qty) => addComponent(kit.id, productId, qty)} />
              </div>

              {expandedId === kit.id && (
                <div className="mt-3 grid grid-cols-1 gap-4 border-t border-slate-100 pt-3 dark:border-slate-800 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Foto</label>
                    <div className="mt-1">
                      <PhotoField
                        storeId={store.id}
                        value={kit.image_url ?? ""}
                        onChange={(url) => updateKit(kit.id, { image_url: url || null })}
                        uploadPrefix="kit"
                        promptSeed={buildDefaultPrompt(kit.name, kit.kit_items.map((i) => i.products?.name ?? ""))}
                        catalogProducts={products}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Começa em</label>
                      <input
                        type="date"
                        defaultValue={kit.starts_at ? kit.starts_at.slice(0, 10) : ""}
                        onBlur={(e) => updateKit(kit.id, { starts_at: e.target.value ? new Date(e.target.value + "T00:00:00").toISOString() : null })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Termina em</label>
                      <input
                        type="date"
                        defaultValue={kit.ends_at ? kit.ends_at.slice(0, 10) : ""}
                        onBlur={(e) => updateKit(kit.id, { ends_at: e.target.value ? new Date(e.target.value + "T23:59:59").toISOString() : null })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Histórico de preço</label>
                    <div className="mt-1">
                      <KitPriceHistoryChart kitId={kit.id} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}

function ComponentForm({ products, onAdd }: { products: Product[]; onAdd: (productId: string, quantity: number) => void }) {
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");

  const selected = products.find((p) => p.id === productId);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={productId}
        onChange={(e) => {
          setProductId(e.target.value);
          const p = products.find((x) => x.id === e.target.value);
          setQuantity(p?.sold_by_weight ? "0.5" : "1");
        }}
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
        min={selected?.sold_by_weight ? 0.001 : 1}
        step={selected?.sold_by_weight ? 0.001 : 1}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
      />
      {selected?.sold_by_weight && <span className="text-xs text-slate-400">kg</span>}
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
