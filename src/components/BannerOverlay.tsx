export type BannerTextStyle = "faixa-inferior" | "selo-canto" | "faixa-lateral";

export const BANNER_TEXT_STYLES: { value: BannerTextStyle; label: string }[] = [
  { value: "faixa-inferior", label: "Faixa inferior" },
  { value: "selo-canto", label: "Selo no canto" },
  { value: "faixa-lateral", label: "Faixa lateral" },
];

// Camada de texto desenhada por cima do banner — nunca é cortada pelo
// object-cover da imagem porque não faz parte da foto, é HTML de verdade.
// Usado tanto na prévia do painel quanto na vitrine, pra garantir que os
// dois fiquem sempre idênticos.
export function BannerOverlay({
  style,
  text,
}: {
  style: string | null;
  text: string | null;
}) {
  if (!style || !text?.trim()) return null;

  if (style === "faixa-inferior") {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-end rounded-2xl bg-gradient-to-t from-black/75 via-black/15 to-transparent p-3">
        <p className="text-base font-extrabold leading-tight text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)] sm:text-lg">
          {text}
        </p>
      </div>
    );
  }

  if (style === "faixa-lateral") {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center rounded-2xl bg-gradient-to-r from-black/75 via-black/25 to-transparent p-3">
        <p className="max-w-[65%] text-base font-extrabold leading-tight text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)] sm:text-lg">
          {text}
        </p>
      </div>
    );
  }

  // selo-canto
  return (
    <div className="pointer-events-none absolute right-2 top-2">
      <span className="inline-block -rotate-6 rounded-full bg-[var(--accent-bg,#f59e0b)] px-3 py-1.5 text-xs font-extrabold text-[var(--accent-text,#1a1a1a)] shadow-md sm:text-sm">
        {text}
      </span>
    </div>
  );
}
