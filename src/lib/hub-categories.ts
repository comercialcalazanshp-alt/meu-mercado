// Traduz a categoria (texto livre que o dono digita ao cadastrar um
// afiliado/módulo) num ícone — puramente de apresentação, não muda nada no
// banco. Qualquer categoria que não bater com uma palavra-chave conhecida
// cai no ícone genérico de loja.
import {
  ShoppingCart,
  Beef,
  Croissant,
  Apple,
  Wine,
  CakeSlice,
  Cross,
  PawPrint,
  Store,
  type LucideIcon,
} from "lucide-react";

const KEYWORD_ICON: [string, LucideIcon][] = [
  ["mercado", ShoppingCart],
  ["super", ShoppingCart],
  ["açougue", Beef],
  ["acougue", Beef],
  ["carne", Beef],
  ["padaria", Croissant],
  ["pão", Croissant],
  ["hortifruti", Apple],
  ["horti", Apple],
  ["fruta", Apple],
  ["verdura", Apple],
  ["bebida", Wine],
  ["adega", Wine],
  ["confeitaria", CakeSlice],
  ["doce", CakeSlice],
  ["bolo", CakeSlice],
  ["farmácia", Cross],
  ["farmacia", Cross],
  ["pet", PawPrint],
];

export function categoryIcon(category: string): LucideIcon {
  const normalized = category.trim().toLowerCase();
  for (const [keyword, icon] of KEYWORD_ICON) {
    if (normalized.includes(keyword)) return icon;
  }
  return Store;
}
