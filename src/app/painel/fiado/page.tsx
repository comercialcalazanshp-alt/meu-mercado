"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// O Crediário foi incorporado à tela de Clientes (débito, pagamento, extrato
// e venda fiado ficam dentro de cada cliente). Esta rota só existe pra links
// e favoritos antigos não quebrarem.
function RedirectToClientes() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    router.replace(`/painel/clientes${query ? `?${query}` : ""}`);
  }, [router, searchParams]);

  return <p className="text-sm text-slate-500">Abrindo Clientes…</p>;
}

export default function Fiado() {
  return (
    <Suspense fallback={null}>
      <RedirectToClientes />
    </Suspense>
  );
}
