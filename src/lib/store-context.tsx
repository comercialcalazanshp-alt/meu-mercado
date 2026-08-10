"use client";

import { createContext, useContext } from "react";

export type Store = {
  id: string;
  slug: string;
  name: string;
  whatsapp: string | null;
  active: boolean;
};

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useStore() só pode ser usado dentro do painel (StoreContext ausente).");
  }
  return store;
}
