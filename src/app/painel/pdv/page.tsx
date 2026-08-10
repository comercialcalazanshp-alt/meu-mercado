"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Product = {
  id: string;
  name: string;
  price: number;
  stock: number;
};

type CartLine = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  stock: number;
};

type PaymentMethod = "dinheiro" | "pix" | "cartao" | "fiado";

const CASH_BUTTONS = [5, 10, 20, 50, 100, 200];

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Pdv() {
  const store = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ total: number; troco: number | null } | null>(null);

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddPrice, setQuickAddPrice] = useState("");
  const [quickAddStock, setQuickAddStock] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);

  async function loadProducts() {
    setLoadingProducts(true);
    const { data } = await getSupabase()
      .from("products")
      .select("id, name, price, stock")
      .eq("store_id", store.id)
      .order("name", { ascending: true });
    setProducts(data ?? []);
    setLoadingProducts(false);
  }

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [search, products]);

  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const cashReceivedValue = Number(cashReceived.replace(",", ".")) || 0;
  const troco = cashReceivedValue - total;

  function focusSearch() {
    searchInputRef.current?.focus();
  }

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        { productId: product.id, name: product.name, price: product.price, quantity: 1, stock: product.stock },
      ];
    });
    setSearch("");
    setQuickAddOpen(false);
    setSuccess(null);
    focusSearch();
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      addToCart(filtered[0]);
    }
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault();
    const priceValue = Number(quickAddPrice.replace(",", "."));
    const stockValue = Number(quickAddStock) || 0;
    if (!search.trim() || Number.isNaN(priceValue) || priceValue < 0) return;

    setQuickAddSaving(true);
    const { data, error: insertError } = await getSupabase()
      .from("products")
      .insert({ store_id: store.id, name: search.trim(), price: priceValue, stock: stockValue })
      .select("id, name, price, stock")
      .single();
    setQuickAddSaving(false);

    if (insertError || !data) {
      setError("Não deu pra cadastrar o produto: " + insertError?.message);
      return;
    }

    setProducts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setQuickAddPrice("");
    setQuickAddStock("");
    addToCart(data);
  }

  function selectPayment(method: PaymentMethod) {
    setPaymentMethod(method);
    setError(null);
    if (method !== "dinheiro") setCashReceived("");
  }

  const canFinalize =
    cart.length > 0 &&
    paymentMethod !== null &&
    !saving &&
    !(paymentMethod === "dinheiro" && cashReceivedValue < total) &&
    !(paymentMethod === "fiado" && !customerPhone.trim());

  async function handleFinalize() {
    if (!canFinalize || !paymentMethod) return;
    setSaving(true);
    setError(null);

    const { data, error: rpcError } = await getSupabase().rpc("pdv_sale", {
      p_store_id: store.id,
      p_items: cart.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
      p_payment_method: paymentMethod,
      p_customer_name: customerName.trim() || "Cliente balcão",
      p_customer_phone: customerPhone.trim() || null,
    });
    setSaving(false);

    if (rpcError || !data || data.length === 0) {
      setError(rpcError?.message ?? "Não deu pra registrar a venda.");
      return;
    }

    const sale = data[0];
    setSuccess({
      total: sale.total,
      troco: paymentMethod === "dinheiro" ? cashReceivedValue - sale.total : null,
    });
    setCart([]);
    setPaymentMethod(null);
    setCashReceived("");
    setCustomerName("");
    setCustomerPhone("");
    loadProducts();
    focusSearch();
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">PDV — venda no balcão</h1>

        <div className="relative mt-4">
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setQuickAddOpen(false);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Buscar produto pelo nome…"
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />

          {search.trim() && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
              {loadingProducts ? (
                <p className="px-4 py-3 text-sm text-slate-500">Carregando…</p>
              ) : filtered.length > 0 ? (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className="text-slate-900 dark:text-slate-50">{p.name}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {formatCurrency(p.price)} · estoque {p.stock}
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-4 py-3">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Nenhum produto encontrado pra &quot;{search.trim()}&quot;.
                  </p>
                  {!quickAddOpen ? (
                    <button
                      onClick={() => setQuickAddOpen(true)}
                      className="mt-2 text-sm font-medium text-blue-900 hover:underline dark:text-blue-400"
                    >
                      Cadastrar rápido
                    </button>
                  ) : (
                    <form onSubmit={handleQuickAdd} className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        value={quickAddPrice}
                        onChange={(e) => setQuickAddPrice(e.target.value)}
                        placeholder="Preço (R$)"
                        inputMode="decimal"
                        autoFocus
                        className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                      <input
                        value={quickAddStock}
                        onChange={(e) => setQuickAddStock(e.target.value)}
                        placeholder="Estoque"
                        inputMode="numeric"
                        className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      />
                      <button
                        type="submit"
                        disabled={quickAddSaving}
                        className="rounded-lg bg-blue-900 px-3 py-1 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
                      >
                        {quickAddSaving ? "Salvando…" : "Salvar e adicionar"}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 space-y-2">
          {cart.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Carrinho vazio — busque um produto acima pra começar a venda.
            </p>
          )}
          {cart.map((line) => (
            <div
              key={line.productId}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900 dark:text-slate-50">{line.name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{formatCurrency(line.price)} un.</p>
                {line.quantity > line.stock && (
                  <p className="text-xs font-medium text-red-600">
                    Só tem {line.stock} em estoque
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => changeQuantity(line.productId, -1)}
                  className="h-8 w-8 rounded-lg border border-slate-300 text-lg leading-none text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  −
                </button>
                <span className="w-6 text-center font-semibold text-slate-900 dark:text-slate-50">
                  {line.quantity}
                </span>
                <button
                  onClick={() => changeQuantity(line.productId, 1)}
                  className="h-8 w-8 rounded-lg border border-slate-300 text-lg leading-none text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  +
                </button>
              </div>
              <p className="w-24 text-right font-semibold text-slate-900 dark:text-slate-50">
                {formatCurrency(line.price * line.quantity)}
              </p>
              <button
                onClick={() => removeLine(line.productId)}
                className="text-sm text-red-600 hover:underline"
              >
                Remover
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="h-fit rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {success && (
          <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
            <p className="font-semibold">Venda registrada! {formatCurrency(success.total)}</p>
            {success.troco !== null && (
              <p>Troco: {formatCurrency(Math.max(0, success.troco))}</p>
            )}
          </div>
        )}

        <p className="text-sm text-slate-500 dark:text-slate-400">Total</p>
        <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">{formatCurrency(total)}</p>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Forma de pagamento</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["dinheiro", "Dinheiro"],
                ["pix", "Pix"],
                ["cartao", "Cartão"],
                ["fiado", "Fiado"],
              ] as [PaymentMethod, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => selectPayment(value)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  paymentMethod === value
                    ? "border-blue-900 bg-blue-900 text-amber-300 dark:border-blue-700 dark:bg-blue-800"
                    : "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {paymentMethod === "dinheiro" && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-2">
              {CASH_BUTTONS.map((value) => (
                <button
                  key={value}
                  onClick={() =>
                    setCashReceived((prev) => String((Number(prev.replace(",", ".")) || 0) + value))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  +{formatCurrency(value)}
                </button>
              ))}
              <button
                onClick={() => setCashReceived(String(total))}
                className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Valor exato
              </button>
            </div>
            <input
              value={cashReceived}
              onChange={(e) => setCashReceived(e.target.value)}
              placeholder="Valor recebido (R$)"
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
            <p className={`text-sm font-semibold ${troco < 0 ? "text-red-600" : "text-green-600"}`}>
              Troco: {formatCurrency(Math.max(0, troco))}
              {troco < 0 && " (falta " + formatCurrency(-troco) + ")"}
            </p>
          </div>
        )}

        {paymentMethod === "fiado" && (
          <div className="mt-4 space-y-2">
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nome do cliente"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="WhatsApp do cliente (obrigatório)"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          onClick={handleFinalize}
          disabled={!canFinalize}
          className="mt-4 w-full rounded-lg bg-blue-900 px-4 py-3 text-base font-semibold text-amber-300 disabled:opacity-40 dark:bg-blue-800"
        >
          {saving ? "Registrando…" : "Finalizar venda"}
        </button>
      </div>
    </div>
  );
}
