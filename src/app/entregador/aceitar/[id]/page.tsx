import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import AceitarForm from "./aceitar-form-client";

export const dynamic = "force-dynamic";

export default async function AceitarEntregador({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: member } = await supabase
    .from("store_members")
    .select("id, full_name, terms_accepted_at, store_id")
    .eq("id", id)
    .eq("role", "entregador")
    .maybeSingle();

  if (!member) notFound();

  const { data: store } = await supabase.from("stores").select("name").eq("id", member.store_id).single();

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <h1 className="text-xl font-bold text-slate-900">Termo de condições de trabalho</h1>
      <p className="mt-1 text-sm text-slate-600">
        Olá, <b>{member.full_name}</b>! Você foi convidado(a) pra fazer entregas pela{" "}
        <b>{store?.name ?? "loja"}</b>.
      </p>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p className="mb-2 font-semibold text-slate-900">Ao confirmar, você concorda em:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Fazer as entregas com cuidado, pontualidade e educação com os clientes.</li>
          <li>Confirmar certinho no aplicativo quando retirar e quando concluir cada entrega.</li>
          <li>Cobrar exatamente o valor indicado no pedido, quando o pagamento for na entrega.</li>
          <li>Manter em sigilo os dados de clientes (nome, endereço, telefone) que você acessar no trabalho.</li>
          <li>Avisar o responsável da loja na hora, se tiver algum problema, atraso ou recusa do cliente.</li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Esse termo é um acordo interno sobre o uso do aplicativo — não substitui um contrato de trabalho
          formal, que deve ser tratado à parte com o responsável da loja, se for o caso.
        </p>
      </div>

      <AceitarForm id={member.id} fullName={member.full_name ?? ""} jaConfirmado={!!member.terms_accepted_at} />
    </div>
  );
}
