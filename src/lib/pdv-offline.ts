"use client";

// Guarda localmente (IndexedDB, no próprio aparelho) o catálogo de
// produtos/kits e a fila de vendas feitas sem internet, pro PDV continuar
// vendendo de verdade durante uma queda de conexão — sem isso, a tela
// simplesmente parava de funcionar assim que a internet caía.
//
// Fluxo: sempre que o PDV carrega com internet, atualiza esse cache. Se a
// venda (pdv_sale) falhar por falta de rede, cai numa fila local em vez de
// mostrar erro pro caixa. Assim que a internet volta, cada venda da fila é
// reenviada de verdade pro servidor.

const DB_NAME = "mm-pdv-offline";
const DB_VERSION = 1;

type CachedProduct = {
  id: string;
  name: string;
  price: number;
  stock: number;
  barcode: string | null;
  sold_by_weight: boolean;
  promo_buy_qty: number | null;
  promo_pay_qty: number | null;
  price_wholesale: number | null;
  wholesale_min_qty: number | null;
  price_fiado: number | null;
  on_offer: boolean;
  offer_price: number | null;
  offer_ends_at: string | null;
};

type CachedKit = { id: string; name: string; price: number; buildable: number };

export type PendingSale = {
  localId: string;
  storeId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  cartSnapshot: unknown;
  status: "pending" | "failed";
  lastError?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("products")) {
        db.createObjectStore("products", { keyPath: "cacheKey" });
      }
      if (!db.objectStoreNames.contains("kits")) {
        db.createObjectStore("kits", { keyPath: "cacheKey" });
      }
      if (!db.objectStoreNames.contains("pendingSales")) {
        db.createObjectStore("pendingSales", { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheProducts(storeId: string, products: CachedProduct[]) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("products", "readwrite");
    const store = tx.objectStore("products");
    const range = IDBKeyRange.bound(`${storeId}:`, `${storeId}:￿`);
    store.delete(range);
    for (const p of products) {
      store.put({ ...p, cacheKey: `${storeId}:${p.id}` });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedProducts(storeId: string): Promise<CachedProduct[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("products", "readonly");
    const range = IDBKeyRange.bound(`${storeId}:`, `${storeId}:￿`);
    const req = tx.objectStore("products").getAll(range);
    req.onsuccess = () => resolve(req.result as CachedProduct[]);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheKits(storeId: string, kits: CachedKit[]) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("kits", "readwrite");
    const store = tx.objectStore("kits");
    const range = IDBKeyRange.bound(`${storeId}:`, `${storeId}:￿`);
    store.delete(range);
    for (const k of kits) {
      store.put({ ...k, cacheKey: `${storeId}:${k.id}` });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedKits(storeId: string): Promise<CachedKit[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kits", "readonly");
    const range = IDBKeyRange.bound(`${storeId}:`, `${storeId}:￿`);
    const req = tx.objectStore("kits").getAll(range);
    req.onsuccess = () => resolve(req.result as CachedKit[]);
    req.onerror = () => reject(req.error);
  });
}

export async function queueSale(storeId: string, payload: Record<string, unknown>, cartSnapshot: unknown) {
  const sale: PendingSale = {
    localId: crypto.randomUUID(),
    storeId,
    payload,
    cartSnapshot,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  await withStore("pendingSales", "readwrite", (store) => store.put(sale));
  return sale;
}

export async function getPendingSales(storeId: string): Promise<PendingSale[]> {
  const all = await withStore<PendingSale[]>("pendingSales", "readonly", (store) => store.getAll());
  return all.filter((s) => s.storeId === storeId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removePendingSale(localId: string) {
  await withStore("pendingSales", "readwrite", (store) => store.delete(localId));
}

export async function markPendingSaleFailed(localId: string, error: string) {
  const sale = await withStore<PendingSale>("pendingSales", "readonly", (store) => store.get(localId));
  if (!sale) return;
  await withStore("pendingSales", "readwrite", (store) => store.put({ ...sale, status: "failed", lastError: error }));
}

export function isOfflineCapable() {
  return typeof window !== "undefined" && "indexedDB" in window;
}
