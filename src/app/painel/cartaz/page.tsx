"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useStore } from "@/lib/store-context";

export default function Cartaz() {
  const store = useStore();
  const [storeUrl, setStoreUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    const url = `${window.location.origin}/loja/${store.slug}`;
    setStoreUrl(url);
    QRCode.toDataURL(url, { width: 480, margin: 1, color: { dark: "#1e3a8a", light: "#ffffff" } }).then(
      setQrDataUrl,
    );
  }, [store.slug]);

  return (
    <div>
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Cartaz da loja</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Um cartaz com QR code pra imprimir e deixar no balcão, na vitrine ou colar num ponto de entrega —
          quem escanear cai direto na sua loja online.
        </p>
        <button
          onClick={() => window.print()}
          disabled={!qrDataUrl}
          className="mt-4 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          Imprimir / salvar como PDF
        </button>
      </div>

      <div
        id="cartaz-print-area"
        className="mx-auto mt-6 flex aspect-[210/297] w-full max-w-[420px] flex-col items-center justify-center gap-6 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm print:mt-0 print:aspect-auto print:w-full print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none dark:border-slate-800 dark:bg-slate-900 print:dark:bg-white"
      >
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-900 dark:text-blue-400 print:text-blue-900">
          Peça online
        </p>
        <h2 className="text-3xl font-bold leading-tight text-slate-900 dark:text-slate-50 print:text-slate-900">
          {store.name}
        </h2>
        {qrDataUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={qrDataUrl} alt={`QR code para ${storeUrl}`} className="h-56 w-56" />
        ) : (
          <div className="h-56 w-56 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        )}
        <p className="text-lg font-medium text-slate-700 dark:text-slate-300 print:text-slate-700">
          Aponte a câmera do celular pro QR code
        </p>
        <p className="break-all text-sm text-slate-500 dark:text-slate-400 print:text-slate-500">{storeUrl}</p>
        {store.whatsapp && (
          <p className="text-sm text-slate-500 dark:text-slate-400 print:text-slate-500">
            Ou chame no WhatsApp: {store.whatsapp}
          </p>
        )}
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:hidden,
          .print\\:hidden * {
            visibility: hidden !important;
          }
          #cartaz-print-area,
          #cartaz-print-area * {
            visibility: visible;
          }
          #cartaz-print-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
