"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { deleteMyAccount } from "./actions";

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

export default function MinhaConta() {
  const store = useStore();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(store.name);
  const [whatsapp, setWhatsapp] = useState(store.whatsapp ?? "");
  const [brandColor, setBrandColor] = useState("#1e3a8a");
  const [savingStore, setSavingStore] = useState(false);
  const [storeSaved, setStoreSaved] = useState(false);

  const [hoursEnabled, setHoursEnabled] = useState(false);
  const [opensAt, setOpensAt] = useState("08:00");
  const [closesAt, setClosesAt] = useState("18:00");
  const [openDays, setOpenDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [manuallyClosed, setManuallyClosed] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [hoursSaved, setHoursSaved] = useState(false);

  const [accountantToken, setAccountantToken] = useState<string | null>(null);
  const [regeneratingToken, setRegeneratingToken] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const canDelete = confirmText.trim() === store.slug;

  useEffect(() => {
    getSupabase()
      .from("stores")
      .select("business_hours_enabled, opens_at, closes_at, open_days, manually_closed, accountant_token, brand_color")
      .eq("id", store.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setHoursEnabled(data.business_hours_enabled);
        if (data.opens_at) setOpensAt(data.opens_at.slice(0, 5));
        if (data.closes_at) setClosesAt(data.closes_at.slice(0, 5));
        if (data.open_days) setOpenDays(data.open_days);
        setManuallyClosed(data.manually_closed);
        setAccountantToken(data.accountant_token);
        if (data.brand_color) setBrandColor(data.brand_color);
      });
  }, [store.id]);

  const accountantUrl =
    accountantToken && typeof window !== "undefined"
      ? `${window.location.origin}/contador/${accountantToken}`
      : "";

  async function copyAccountantLink() {
    if (!accountantUrl) return;
    await navigator.clipboard.writeText(accountantUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function regenerateAccountantLink() {
    if (!confirm("Gerar um novo link? O link antigo para de funcionar na hora.")) return;
    setRegeneratingToken(true);
    const { data, error: regenError } = await getSupabase()
      .from("stores")
      .update({ accountant_token: crypto.randomUUID() })
      .eq("id", store.id)
      .select("accountant_token")
      .single();
    setRegeneratingToken(false);
    if (!regenError && data) setAccountantToken(data.accountant_token);
  }

  async function handleSaveStore(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingStore(true);
    setStoreSaved(false);
    const { error: updateError } = await getSupabase()
      .from("stores")
      .update({ name: name.trim(), whatsapp: whatsapp.trim() || null, brand_color: brandColor })
      .eq("id", store.id);
    setSavingStore(false);
    if (!updateError) {
      setStoreSaved(true);
      setTimeout(() => window.location.reload(), 600);
    }
  }

  function toggleDay(day: number) {
    setOpenDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  }

  async function handleSaveHours(e: FormEvent) {
    e.preventDefault();
    setSavingHours(true);
    setHoursSaved(false);
    const { error: updateError } = await getSupabase()
      .from("stores")
      .update({
        business_hours_enabled: hoursEnabled,
        opens_at: opensAt,
        closes_at: closesAt,
        open_days: openDays,
        manually_closed: manuallyClosed,
      })
      .eq("id", store.id);
    setSavingHours(false);
    if (!updateError) {
      setHoursSaved(true);
      setTimeout(() => setHoursSaved(false), 2500);
    }
  }

  async function handleDelete() {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError(null);

    const {
      data: { session },
    } = await getSupabase().auth.getSession();

    if (!session) {
      setError("Sua sessão expirou. Recarregue a página e entre de novo.");
      setDeleting(false);
      return;
    }

    const result = await deleteMyAccount(session.access_token);

    if (result.error) {
      setError(result.error);
      setDeleting(false);
      return;
    }

    await getSupabase().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Minha conta</h1>

      <form
        onSubmit={handleSaveStore}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Dados da loja
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">/{store.slug}</p>
        <div className="mt-3 space-y-2">
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Nome da loja</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">WhatsApp da loja</label>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(11) 91234-5678"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">
              Cor da loja no site
            </label>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
              Usada no cabeçalho e nos botões principais da vitrine — o texto em cima se ajusta
              sozinho pra ficar legível.
            </p>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
              />
              <span
                className="rounded-lg px-3 py-1.5 text-sm font-semibold"
                style={{
                  backgroundColor: brandColor,
                  color:
                    parseInt(brandColor.slice(1, 3), 16) * 0.299 +
                      parseInt(brandColor.slice(3, 5), 16) * 0.587 +
                      parseInt(brandColor.slice(5, 7), 16) * 0.114 >
                    140
                      ? "#1e293b"
                      : "#fbbf24",
                }}
              >
                Prévia
              </span>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={savingStore || !name.trim()}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingStore ? "Salvando…" : "Salvar"}
          </button>
          {storeSaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
      </form>

      <form
        onSubmit={handleSaveHours}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Horário de funcionamento
        </h2>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={hoursEnabled}
            onChange={(e) => setHoursEnabled(e.target.checked)}
          />
          Avisar cliente quando a loja estiver fechada
        </label>

        {hoursEnabled && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400">Abre</label>
                <input
                  type="time"
                  value={opensAt}
                  onChange={(e) => setOpensAt(e.target.value)}
                  className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400">Fecha</label>
                <input
                  type="time"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                  className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400">Dias abertos</label>
              <div className="mt-1 flex flex-wrap gap-1">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                      openDays.includes(d.value)
                        ? "border-blue-900 bg-blue-900 text-amber-300 dark:border-blue-700 dark:bg-blue-800"
                        : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={manuallyClosed}
                onChange={(e) => setManuallyClosed(e.target.checked)}
              />
              Fechar a loja agora (feriado, imprevisto) — ignora o horário acima
            </label>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={savingHours}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingHours ? "Salvando…" : "Salvar horário"}
          </button>
          {hoursSaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
      </form>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Link do contador
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Compartilhe esse link com seu contador — ele vê um resumo de vendas, despesas e fiado em
          aberto, sem conseguir editar nada e sem precisar da sua senha.
        </p>
        {accountantUrl && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              readOnly
              value={accountantUrl}
              onFocus={(e) => e.target.select()}
              className="w-full flex-1 truncate rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
            />
            <div className="flex shrink-0 gap-2">
              <button
                onClick={copyAccountantLink}
                className="rounded-lg bg-blue-900 px-3 py-2 text-xs font-semibold text-amber-300 dark:bg-blue-800"
              >
                {linkCopied ? "Copiado!" : "Copiar link"}
              </button>
              <button
                onClick={regenerateAccountantLink}
                disabled={regeneratingToken}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
              >
                {regeneratingToken ? "Gerando…" : "Gerar novo link"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
        <h2 className="font-semibold text-red-700 dark:text-red-400">Excluir minha conta e loja</h2>
        <p className="mt-1 text-sm text-red-700/80 dark:text-red-400/80">
          Isso apaga sua conta, sua loja, todos os produtos, pedidos, cupons, banners, kits e o
          histórico de fiado. Não tem como desfazer.
        </p>
        <label className="mt-3 block text-sm font-medium text-red-700 dark:text-red-400">
          Digite <span className="font-mono">{store.slug}</span> pra confirmar
        </label>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mt-1 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-red-900/50 dark:bg-slate-900 dark:text-slate-50"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={handleDelete}
          disabled={!canDelete || deleting}
          className="mt-3 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {deleting ? "Excluindo…" : "Excluir minha conta permanentemente"}
        </button>
      </div>
    </div>
  );
}
