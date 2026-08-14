"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getCustomerSupabase } from "@/lib/supabase-customer";

function ConfirmadoClienteContent() {
  const params = useSearchParams();
  const loja = params.get("loja") ?? "";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = getCustomerSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-900 text-2xl font-bold text-amber-300 dark:bg-blue-800">
        ✓
      </div>
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">
        {ready ? "Conta confirmada!" : "Confirmando…"}
      </h1>
      {ready && (
        <>
          <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">
            Sua conta já está ativa. Cashback, raspadinha e indicação já funcionam nos seus próximos
            pedidos.
          </p>
          <a
            href={loja ? `/loja/${loja}` : "/"}
            className="mt-2 rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-semibold text-amber-300 dark:bg-blue-800"
          >
            {loja ? "Voltar pra loja" : "Ir pro Meu Mercado"}
          </a>
        </>
      )}
    </div>
  );
}

export default function ConfirmadoCliente() {
  return (
    <Suspense fallback={null}>
      <ConfirmadoClienteContent />
    </Suspense>
  );
}
