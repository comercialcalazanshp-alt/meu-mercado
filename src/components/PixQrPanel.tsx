"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useStore } from "@/lib/store-context";
import { buildPixBRCode } from "@/lib/pix-brcode";
import { formatCurrency } from "@/lib/credit";

// QR Pix "estático" com valor, gerado no próprio navegador a partir da chave
// Pix da loja (mesmo formato do PDV). O dinheiro cai direto na conta do dono;
// o sistema não fica sabendo do pagamento, então quem recebe confere no banco
// e só depois registra.
export default function PixQrPanel({ amount }: { amount: number }) {
  const store = useStore();
  const keys = [
    { key: store.pix_key_1, label: store.pix_key_1_label || "Conta 1" },
    { key: store.pix_key_2, label: store.pix_key_2_label || "Conta 2" },
  ].filter((k): k is { key: string; label: string } => !!k.key);

  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<{ id: string; code: string; image: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const chosen = keys[Math.min(selected, keys.length - 1)];
  const valid = Number.isFinite(amount) && amount > 0;
  const currentId = chosen && valid ? `${chosen.key}|${amount.toFixed(2)}` : null;

  useEffect(() => {
    if (!chosen || !valid || !currentId) return;
    let cancelled = false;
    const code = buildPixBRCode({
      pixKey: chosen.key,
      merchantName: store.pix_receiver_name || store.name,
      merchantCity: store.pix_city || "BRASIL",
      amount,
    });
    QRCode.toDataURL(code, { width: 260, margin: 1 })
      .then((image) => {
        if (!cancelled) setResult({ id: currentId, code, image });
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  async function copyCode() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // sem permissão de área de transferência — o QR continua funcionando
    }
  }

  if (keys.length === 0) {
    return (
      <p className="mt-3 text-sm text-white/40">
        Nenhuma chave Pix cadastrada ainda — configure em Configurações.
      </p>
    );
  }

  const ready = result && result.id === currentId;

  return (
    <div className="mt-3 space-y-2.5 rounded-xl border border-white/10 p-3.5">
      {keys.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {keys.map((k, i) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setSelected(i)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                chosen.key === k.key
                  ? "border-[#34E88C]/50 bg-[#34E88C]/10 text-[#34E88C]"
                  : "border-white/10 bg-white/[0.03] text-white/60 hover:border-[#34E88C]/40 hover:text-[#34E88C]"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
      {!valid && <p className="text-sm text-white/40">Digite o valor pago pra gerar o QR Pix.</p>}
      {valid && !ready && <p className="text-sm text-white/40">Gerando QR…</p>}
      {valid && ready && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.image} alt={`QR Pix — ${chosen.label}`} className="h-56 w-56" />
          <p className="text-sm font-semibold text-black">{formatCurrency(amount)}</p>
          <button
            type="button"
            onClick={copyCode}
            className="rounded-lg border border-black/15 px-3 py-1 text-xs font-medium text-black/70 hover:bg-black/5"
          >
            {copied ? "Copiado!" : "Copiar código Pix (copia e cola)"}
          </button>
          <p className="text-center text-xs text-black/50">
            Confirme o Pix no seu banco antes de clicar em Confirmar pagamento
          </p>
        </div>
      )}
    </div>
  );
}
