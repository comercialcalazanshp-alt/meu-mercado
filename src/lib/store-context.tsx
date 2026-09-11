"use client";

import { createContext, useContext } from "react";

export type Store = {
  id: string;
  slug: string;
  name: string;
  whatsapp: string | null;
  cnpj: string | null;
  receipt_paper_mm: number;
  active: boolean;
  owner_id: string;
  pix_key_1: string | null;
  pix_key_1_label: string | null;
  pix_key_2: string | null;
  pix_key_2_label: string | null;
  pix_receiver_name: string | null;
  pix_city: string | null;
  finance_split_enabled: boolean;
  finance_split_giro_percent: number;
  finance_split_prolabore_percent: number;
  finance_split_investimento_percent: number;
};

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useStore() só pode ser usado dentro do painel (StoreContext ausente).");
  }
  return store;
}
