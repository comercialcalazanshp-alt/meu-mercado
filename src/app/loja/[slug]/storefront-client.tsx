"use client";

import { useMemo, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";

type Product = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  image_url: string | null;
  stock: number;
};

type Store = {
  id: string;
  slug: string;
  name: string;
  whatsapp: string | null;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function StorefrontClient({
  store,
  products,
}: {
  store: Store;
  products: Product[];
}) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [view, setView] = useState<"catalogo" | "checkout" | "confirmado">("catalogo");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([productId, quantity]) => {
          const product = products.find((p) => p.id === productId);
          return product ? { product, quantity } : null;
        })
        .filter((item): item is { product: Product; quantity: number } => item !== null && item.quantity > 0),
    [cart, products],
  );

  const total = cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  const categories = useMemo(() => {
    const groups = new Map<string, Product[]>();
    for (const product of products) {
      const key = product.category || "Outros";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(product);
    }
    return Array.from(groups.entries());
  }, [products]);

  function setQuantity(productId: string, quantity: number) {
    setCart((prev) => ({ ...prev, [productId]: Math.max(0, quantity) }));
  }

  async function handleCheckout(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    if (cartItems.length === 0) {
      setError("Seu carrinho está vazio.");
      return;
    }

    setSaving(true);
    const { error: insertError } = await getSupabase()
      .from("orders")
      .insert({
        store_id: store.id,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        items: cartItems.map((item) => ({
          name: item.product.name,
          price: item.product.price,
          quantity: item.quantity,
        })),
        total,
      });

    if (insertError) {
      setError("Não deu pra enviar o pedido: " + insertError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setView("confirmado");
  }

  if (view === "confirmado") {
    const whatsappMessage = encodeURIComponent(
      `Olá! Acabei de fazer um pedido na ${store.name} no valor de ${formatCurrency(total)}.`,
    );
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-900 text-2xl font-bold text-amber-300 dark:bg-blue-800">
          ✓
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Pedido enviado!</h1>
        <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
          A loja {store.name} vai receber seu pedido. Total: {formatCurrency(total)}.
        </p>
        {store.whatsapp && (
          <a
            href={`https://wa.me/55${store.whatsapp.replace(/\D/g, "")}?text=${whatsappMessage}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Avisar a loja no WhatsApp
          </a>
        )}
      </div>
    );
  }

  if (view === "checkout") {
    return (
      <div className="flex flex-1 flex-col items-center bg-slate-50 px-6 py-10 dark:bg-slate-950">
        <div className="w-full max-w-sm">
          <button
            onClick={() => setView("catalogo")}
            className="mb-4 text-sm text-slate-500 hover:underline dark:text-slate-400"
          >
            ← Voltar ao catálogo
          </button>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">Finalizar pedido</h1>

          <ul className="mt-4 space-y-1 text-sm">
            {cartItems.map((item) => (
              <li
                key={item.product.id}
                className="flex justify-between text-slate-600 dark:text-slate-400"
              >
                <span>
                  {item.quantity}x {item.product.name}
                </span>
                <span>{formatCurrency(item.product.price * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-slate-200 pt-2 text-right font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-50">
            Total: {formatCurrency(total)}
          </p>

          <form onSubmit={handleCheckout} className="mt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Seu nome
              </label>
              <input
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Seu WhatsApp
              </label>
              <input
                required
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="(11) 91234-5678"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-blue-900 px-4 py-2.5 font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
            >
              {saving ? "Enviando…" : "Enviar pedido"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-slate-50 pb-24 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-900 text-lg font-bold text-amber-300 dark:bg-blue-800">
          {store.name.slice(0, 2).toUpperCase()}
        </div>
        <h1 className="mt-3 text-xl font-bold text-slate-900 dark:text-slate-50">{store.name}</h1>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        {products.length === 0 && (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Essa loja ainda não cadastrou produtos.
          </p>
        )}

        {categories.map(([category, items]) => (
          <section key={category} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {category}
            </h2>
            <div className="space-y-2">
              {items.map((product) => {
                const quantity = cart[product.id] ?? 0;
                return (
                  <div
                    key={product.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                  >
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                        {product.name}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {formatCurrency(product.price)}
                      </p>
                      {product.stock <= 0 && (
                        <p className="text-xs text-red-500">Sem estoque</p>
                      )}
                    </div>
                    {quantity === 0 ? (
                      <button
                        onClick={() => setQuantity(product.id, 1)}
                        disabled={product.stock <= 0}
                        className="shrink-0 rounded-lg bg-blue-900 px-3 py-1.5 text-sm font-semibold text-amber-300 disabled:opacity-40 dark:bg-blue-800"
                      >
                        Adicionar
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => setQuantity(product.id, quantity - 1)}
                          className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                          aria-label="Diminuir quantidade"
                        >
                          −
                        </button>
                        <span className="w-4 text-center text-sm text-slate-900 dark:text-slate-50">
                          {quantity}
                        </span>
                        <button
                          onClick={() => setQuantity(product.id, quantity + 1)}
                          className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                          aria-label="Aumentar quantidade"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <button
            onClick={() => setView("checkout")}
            className="mx-auto flex w-full max-w-2xl items-center justify-between rounded-lg bg-blue-900 px-4 py-3 font-semibold text-amber-300 dark:bg-blue-800"
          >
            <span>{cartCount} {cartCount === 1 ? "item" : "itens"}</span>
            <span>{formatCurrency(total)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
