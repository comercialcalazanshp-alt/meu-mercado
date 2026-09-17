"use client";

import type { CSSProperties, ReactNode, SelectHTMLAttributes } from "react";

// Bloco de vidro básico — cantos arredondados, fundo quase transparente com
// blur, usado como base de todo card do painel novo. `delay` alimenta a
// animação de entrada escalonada (mm-fade-up, definida em globals.css).
export function Card({
  children,
  className = "",
  delay = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`animate-mm-fade-up rounded-2xl border border-white/[0.09] bg-white/[0.035] p-5 backdrop-blur-xl ${className}`}
      style={{ animationDelay: `${delay}ms`, ...style }}
    >
      {children}
    </div>
  );
}

// Cabeçalho de seção com uma bolinha colorida — usado dentro de um Card pra
// separar blocos de conteúdo sem precisar de outro card por bloco.
export function Section({ dot, label, children, className = "" }: { dot: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/35">
        <span className="h-2 w-2 rounded-full" style={{ background: dot, boxShadow: `0 0 6px ${dot}99` }} />
        {label}
      </h3>
      {children}
    </div>
  );
}

// Botão de ação principal — fundo sólido na cor passada (geralmente
// COLOR_HEX.accent ou .positive), texto escuro por cima (as cores do tema
// são todas claras o bastante pra isso funcionar). `as="span"` é pra quando
// o botão precisa ir dentro de um <Link> do Next (não pode aninhar <button>
// dentro de <a>).
export function PrimaryButton({
  hex,
  children,
  onClick,
  disabled,
  as,
  type = "button",
  className = "",
}: {
  hex: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  as?: "span";
  type?: "button" | "submit";
  className?: string;
}) {
  const cls = `inline-flex items-center justify-center rounded-lg px-3.5 py-1.5 text-sm font-semibold text-[#0A0A0C] transition disabled:opacity-50 ${disabled ? "" : "hover:brightness-110"} ${className}`;
  const style = { background: hex };
  if (as === "span") {
    return (
      <span className={cls} style={style}>
        {children}
      </span>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls} style={style}>
      {children}
    </button>
  );
}

// Botão de ação secundária — contorno claro, sem cor sólida, pra ações
// menos importantes (cancelar, reimprimir, fechar).
export function SecondaryButton({
  children,
  onClick,
  disabled,
  small,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  small?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border border-white/[0.12] font-medium text-white/70 transition hover:border-white/25 hover:text-white disabled:opacity-50 ${
        small ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm"
      } ${className}`}
    >
      {children}
    </button>
  );
}

// Select nativo estilizado pro tema escuro — o <select> do navegador não
// aceita muito CSS por dentro (a lista de opções continua com a cara do SO),
// mas a caixa fechada já fica consistente com o resto do painel.
export function SelectField({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-sm text-white backdrop-blur-xl focus:border-[#5CACFF]/50 focus:outline-none disabled:opacity-50 ${className}`}
    />
  );
}

// Interruptor liga/desliga — em cima de um checkbox de verdade (acessível,
// funciona com teclado) só com a aparência trocada.
export function Toggle({
  checked,
  onChange,
  label,
  hex = "#34E88C",
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  hex?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`inline-flex items-center gap-2 text-sm text-white/70 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        style={{ background: checked ? hex : "rgba(255,255,255,0.12)" }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span
          className="pointer-events-none h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? "translateX(18px)" : "translateX(3px)" }}
        />
      </span>
      {label}
    </label>
  );
}

// Wrapper de tabela — cabeçalho discreto, linhas com divisória sutil,
// scroll horizontal próprio (a página nunca deve rolar de lado por causa de
// uma tabela larga).
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.09]">
      <table className="w-full min-w-max text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-white/[0.09] bg-white/[0.03] text-[11px] font-bold uppercase tracking-wide text-white/35">
      <tr>{children}</tr>
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-white/[0.06]">{children}</tbody>;
}

// Janela modal simples — fundo escurecido, fecha ao clicar fora ou em X.
// Ainda sem uso nesta rodada (PDV/Caixa não precisam), pronta pra quando
// Produtos/Parceria migrarem seus modais no estilo antigo.
export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="animate-mm-scale-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/[0.09] bg-[#0A0A0C] p-5 backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-bold text-white">{title}</h2>}
          <button onClick={onClose} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/[0.06] hover:text-white/80">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function IconChevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="11" cy="11" r="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m21 21-4.3-4.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export { SEMANTIC_COLORS, useThemeColors } from "./theme";
