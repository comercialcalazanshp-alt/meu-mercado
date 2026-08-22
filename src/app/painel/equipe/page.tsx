"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Member = {
  id: string;
  email: string;
  created_at: string;
  role: "completo" | "caixa" | "entregador";
  full_name: string | null;
  phone: string | null;
  terms_accepted_at: string | null;
  value_per_delivery: number | null;
  active: boolean;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const ROLE_LABEL: Record<Member["role"], string> = {
  completo: "Acesso completo",
  caixa: "Só caixa/PDV",
  entregador: "Só entregas",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function pseudoEmailFromPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@entregador.meumercado.app`;
}

function aceitarLink(memberId: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/entregador/aceitar/${memberId}`;
}

function whatsappConviteUrl(member: Member) {
  const digits = (member.phone ?? "").replace(/\D/g, "");
  const texto = `Oi, ${member.full_name ?? ""}! Pra confirmar que você vai fazer entregas pela gente, abre esse link, lê o termo e digita SIM:\n${aceitarLink(member.id)}`;
  return `https://wa.me/55${digits}?text=${encodeURIComponent(texto)}`;
}

function whatsappCredentialsUrl(member: Member, email: string, senha: string) {
  const digits = (member.phone ?? "").replace(/\D/g, "");
  const texto = `Oi, ${member.full_name ?? ""}! Seu acesso pra entregas:\nLogin: ${email}\nSenha: ${senha}\n\nGuarda com cuidado, essa senha não aparece de novo.`;
  return `https://wa.me/55${digits}?text=${encodeURIComponent(texto)}`;
}

export default function Equipe() {
  const store = useStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("completo");
  const [entregadorNome, setEntregadorNome] = useState("");
  const [entregadorTelefone, setEntregadorTelefone] = useState("");
  const [entregadorNascimento, setEntregadorNascimento] = useState("");
  const [entregadorValor, setEntregadorValor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, { email: string; senha: string }>>({});
  const [deliveryCounts, setDeliveryCounts] = useState<Record<string, number>>({});
  const [payingId, setPayingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setIsOwner(!!session && session.user.id === store.owner_id);

    const { data } = await supabase
      .from("store_members")
      .select("id, email, created_at, role, full_name, phone, terms_accepted_at, value_per_delivery, active")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    setMembers((data ?? []) as Member[]);

    const { data: unsettled } = await supabase
      .from("orders")
      .select("delivered_by")
      .eq("store_id", store.id)
      .eq("delivery_payout_settled", false)
      .not("delivered_by", "is", null);
    const counts: Record<string, number> = {};
    for (const o of (unsettled ?? []) as { delivered_by: string }[]) {
      counts[o.delivered_by] = (counts[o.delivered_by] ?? 0) + 1;
    }
    setDeliveryCounts(counts);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (role === "entregador") {
      if (!entregadorNome.trim() || !entregadorTelefone.trim() || !entregadorNascimento || !entregadorValor) {
        setError("Preencha nome completo, telefone, data de nascimento e valor por entrega.");
        return;
      }
      const valor = Number(entregadorValor.replace(",", "."));
      if (Number.isNaN(valor) || valor < 0) {
        setError("Valor por entrega inválido.");
        return;
      }
      setSaving(true);
      const { error: insertError } = await getSupabase().from("store_members").insert({
        store_id: store.id,
        email: pseudoEmailFromPhone(entregadorTelefone),
        role: "entregador",
        full_name: entregadorNome.trim(),
        phone: entregadorTelefone.trim(),
        birth_date: entregadorNascimento,
        value_per_delivery: valor,
      });
      setSaving(false);
      if (insertError) {
        setError(
          insertError.code === "23505"
            ? "Já tem alguém da equipe cadastrado com esse telefone."
            : "Não deu pra cadastrar: " + insertError.message,
        );
        return;
      }
      setEntregadorNome("");
      setEntregadorTelefone("");
      setEntregadorNascimento("");
      setEntregadorValor("");
      setRole("completo");
      load();
      return;
    }

    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Digite um e-mail válido.");
      return;
    }
    setSaving(true);
    const { error: insertError } = await getSupabase()
      .from("store_members")
      .insert({ store_id: store.id, email: trimmed, role });
    setSaving(false);
    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "Esse e-mail já está na equipe."
          : "Não deu pra adicionar: " + insertError.message,
      );
      return;
    }
    setEmail("");
    setRole("completo");
    load();
  }

  async function handleRemove(id: string) {
    if (!confirm("Remover essa pessoa da equipe? Ela perde o acesso ao painel na hora.")) return;
    const supabase = getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch("/api/equipe/remover-entregador", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ storeMemberId: id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Não deu pra remover.");
      return;
    }
    load();
  }

  async function handleToggleActive(id: string, active: boolean) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, active } : m)));
    await getSupabase().from("store_members").update({ active }).eq("id", id);
  }

  async function handleRoleChange(id: string, newRole: Member["role"]) {
    setSavingRoleId(id);
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role: newRole } : m)));
    await getSupabase().from("store_members").update({ role: newRole }).eq("id", id);
    setSavingRoleId(null);
  }

  async function handleMarcarPago(memberId: string) {
    if (!confirm("Marcar todas as entregas pendentes desse entregador como já pagas?")) return;
    setPayingId(memberId);
    await getSupabase()
      .from("orders")
      .update({ delivery_payout_settled: true })
      .eq("store_id", store.id)
      .eq("delivered_by", memberId)
      .eq("delivery_payout_settled", false);
    setPayingId(null);
    load();
  }

  async function handleGerarLogin(memberId: string) {
    setGeneratingId(memberId);
    const supabase = getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setGeneratingId(null);
      return;
    }
    const res = await fetch("/api/equipe/gerar-login-entregador", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ storeMemberId: memberId }),
    });
    const data = await res.json();
    setGeneratingId(null);
    if (!res.ok) {
      alert(data.error ?? "Não deu pra gerar o login.");
      return;
    }
    setCredentials((prev) => ({ ...prev, [memberId]: { email: data.email, senha: data.senha } }));
  }

  if (!loading && !isOwner) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Equipe</h1>
        <p className="mt-2 text-sm text-slate-500">
          Só o dono da loja pode ver e gerenciar quem tem acesso à equipe.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Equipe</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Convide gente de confiança pra ajudar a tocar a loja. "Acesso completo" é como se fosse você
        (produtos, pedidos, PDV, caixa, fiado, relatórios etc.); "Só caixa/PDV" só consegue abrir/fechar
        caixa e vender no balcão; "Só entregas" só vê a lista de entregas do dia — sem ver fiado, despesas,
        relatórios ou mexer no cadastro. Só você continua podendo gerenciar a equipe e excluir a conta.
      </p>

      <form
        onSubmit={handleInvite}
        className="mt-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Member["role"])}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="completo">Acesso completo</option>
          <option value="caixa">Só caixa/PDV</option>
          <option value="entregador">Só entregas</option>
        </select>

        {role === "entregador" ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={entregadorNome}
              onChange={(e) => setEntregadorNome(e.target.value)}
              placeholder="Nome completo"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              type="tel"
              value={entregadorTelefone}
              onChange={(e) => setEntregadorTelefone(e.target.value)}
              placeholder="Telefone (WhatsApp)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Data de nascimento
              <input
                type="date"
                value={entregadorNascimento}
                onChange={(e) => setEntregadorNascimento(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Valor por entrega (R$)
              <input
                type="text"
                inputMode="decimal"
                value={entregadorValor}
                onChange={(e) => setEntregadorValor(e.target.value)}
                placeholder="Ex: 5,00"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
          </div>
        ) : (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@exemplo.com"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        )}

        <button
          type="submit"
          disabled={saving}
          className="shrink-0 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
        >
          {saving ? "Salvando…" : role === "entregador" ? "Cadastrar entregador" : "Adicionar à equipe"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Pra "Acesso completo" e "Só caixa/PDV": a pessoa convidada cria a própria conta em{" "}
        <a href="/cadastro" className="underline">
          /cadastro
        </a>{" "}
        usando esse mesmo e-mail. Pra "Só entregas": você cadastra os dados aqui, manda o termo pelo
        WhatsApp, e só depois que ela confirmar ("SIM") é que dá pra gerar o login/senha pra repassar.
      </p>

      {loading && <p className="mt-6 text-sm text-slate-500">Carregando…</p>}
      {!loading && members.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">Ninguém convidado ainda — só você tem acesso.</p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {members.map((m) => (
          <div
            key={m.id}
            className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-50">
                  {m.role === "entregador" ? (m.full_name ?? m.email) : m.email}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {m.role === "entregador" && m.phone ? `${m.phone} · ` : ""}adicionado em{" "}
                  {formatDate(m.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={m.role}
                  onChange={(e) => handleRoleChange(m.id, e.target.value as Member["role"])}
                  disabled={savingRoleId === m.id}
                  title={ROLE_LABEL[m.role]}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="completo">Acesso completo</option>
                  <option value="caixa">Só caixa/PDV</option>
                  <option value="entregador">Só entregas</option>
                </select>
                <button
                  onClick={() => handleToggleActive(m.id, !m.active)}
                  className={`rounded-lg px-2 py-1 text-xs font-medium ${
                    m.active
                      ? "text-slate-500 hover:underline dark:text-slate-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                  }`}
                >
                  {m.active ? "Pausar" : "Pausado — reativar"}
                </button>
                <button
                  onClick={() => handleRemove(m.id)}
                  className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  Remover
                </button>
              </div>
            </div>

            {m.role === "entregador" && m.full_name && (
              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                {!m.terms_accepted_at ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-400">
                      Aguardando aceite do termo
                    </span>
                    {m.phone && (
                      <a
                        href={whatsappConviteUrl(m)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                      >
                        Mandar termo no WhatsApp
                      </a>
                    )}
                  </div>
                ) : credentials[m.id] ? (
                  <div className="rounded-lg bg-blue-50 p-2.5 text-xs dark:bg-blue-900/20">
                    <p className="font-semibold text-slate-900 dark:text-slate-50">
                      Login: {credentials[m.id].email}
                    </p>
                    <p className="font-semibold text-slate-900 dark:text-slate-50">
                      Senha: {credentials[m.id].senha}
                    </p>
                    <p className="mt-1 text-slate-500 dark:text-slate-400">
                      Anote agora e repasse pra ele — essa senha não vai aparecer de novo aqui.
                    </p>
                    {m.phone && (
                      <a
                        href={whatsappCredentialsUrl(m, credentials[m.id].email, credentials[m.id].senha)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                      >
                        Mandar login/senha no WhatsApp
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
                      Termo aceito em {formatDate(m.terms_accepted_at)}
                    </span>
                    <button
                      onClick={() => handleGerarLogin(m.id)}
                      disabled={generatingId === m.id}
                      className="rounded-lg bg-blue-900 px-2.5 py-1 text-xs font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
                    >
                      {generatingId === m.id ? "Gerando…" : "Gerar login e senha"}
                    </button>
                  </div>
                )}

                {m.value_per_delivery != null && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-2 dark:bg-amber-900/10">
                    <span className="text-xs text-amber-800 dark:text-amber-400">
                      {deliveryCounts[m.id] ?? 0} entrega(s) × {formatCurrency(m.value_per_delivery)} ={" "}
                      <b>{formatCurrency((deliveryCounts[m.id] ?? 0) * m.value_per_delivery)}</b> a receber
                    </span>
                    {(deliveryCounts[m.id] ?? 0) > 0 && (
                      <button
                        onClick={() => handleMarcarPago(m.id)}
                        disabled={payingId === m.id}
                        className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800 disabled:opacity-60 dark:border-amber-700 dark:text-amber-400"
                      >
                        {payingId === m.id ? "Marcando…" : "Marcar como pago"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
