import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import AceitarForm from "./aceitar-form-client";

export const dynamic = "force-dynamic";

export default async function AceitarConviteAfiliado({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: invite } = await supabase
    .from("affiliate_invites")
    .select("id, hub_store_id, category, owner_name, suggested_store_name, commission_percent, status")
    .eq("id", id)
    .maybeSingle();

  if (!invite) notFound();

  const { data: hub } = await supabase.from("stores").select("name").eq("id", invite.hub_store_id).single();

  if (invite.status !== "pendente") {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10 text-center">
        <h1 className="text-xl font-bold text-slate-900">Esse convite já foi usado</h1>
        <p className="mt-2 text-sm text-slate-600">
          Se você já tem uma conta, entre normalmente. Se acha que isso é um engano, fale com {hub?.name ?? "quem te convidou"}.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <h1 className="text-xl font-bold text-slate-900">Convite pra ser afiliado</h1>
      <p className="mt-1 text-sm text-slate-600">
        Olá, <b>{invite.owner_name}</b>! <b>{hub?.name ?? "Um Hub"}</b> te convidou pra vender como afiliado(a), na
        categoria <b>{invite.category}</b>, com comissão de <b>{invite.commission_percent}%</b> por venda.
      </p>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p className="mb-2 font-semibold text-slate-900">Ao aceitar, sua loja "{invite.suggested_store_name}" é criada automaticamente e ligada como afiliada.</p>
        <p className="text-xs text-slate-500">
          Você escolhe seu próprio e-mail e senha agora — é o login que vai usar pra gerenciar produtos, pedidos, caixa
          e tudo mais da sua loja.
        </p>
      </div>

      <AceitarForm inviteId={invite.id} />
    </div>
  );
}
