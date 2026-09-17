"use client";

import { useStore } from "@/lib/store-context";

// Paleta do "vidro escuro" usada em todo o painel (começou no Dashboard,
// depois Clientes) — cores semânticas (positivo/alerta/negativo/roxo) ficam
// fixas de propósito: um saldo de fiado em vermelho precisa continuar
// vermelho não importa a cor de marca escolhida, senão a tela perde
// significado. Só o "accent" (destaque neutro — botão principal, halo de
// fundo, ícone ativo) segue a cor que o dono escolhe em Configurações.
export const SEMANTIC_COLORS = {
  positive: "#34E88C",
  warning: "#F0BB5E",
  afil: "#B37FE8",
  negative: "#FF5C68",
  assin: "#34D9C4",
  entr: "#FF9F5C",
} as const;

const DEFAULT_ACCENT = "#5CACFF";

// store.accent_color já existe (usado hoje só na vitrine) — reaproveita a
// MESMA cor pro painel em vez de criar uma segunda configuração. Devolve um
// hex puro (não uma CSS var) de propósito: várias telas concatenam alpha no
// hex (ex: `${hex}22` pra um fundo translúcido de badge) — isso só funciona
// com uma string hex de verdade, não com var(--algo).
export function useThemeColors() {
  const store = useStore();
  const accent = store.accent_color && /^#[0-9a-fA-F]{6}$/.test(store.accent_color) ? store.accent_color : DEFAULT_ACCENT;
  return { ...SEMANTIC_COLORS, accent };
}
