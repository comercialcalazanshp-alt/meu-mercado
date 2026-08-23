"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { buildReceiptHtml, printHtml } from "@/lib/receipt";
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

const PAPER_WIDTHS = [55, 58, 80];

function previewTextColor(hex: string) {
  const luminance =
    parseInt(hex.slice(1, 3), 16) * 0.299 +
    parseInt(hex.slice(3, 5), 16) * 0.587 +
    parseInt(hex.slice(5, 7), 16) * 0.114;
  return luminance > 140 ? "#1e293b" : "#fbbf24";
}

export default function Configuracoes() {
  const store = useStore();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(store.name);
  const [whatsapp, setWhatsapp] = useState(store.whatsapp ?? "");
  const [cnpj, setCnpj] = useState(store.cnpj ?? "");
  const [brandColor, setBrandColor] = useState("#1e3a8a");
  const [accentColor, setAccentColor] = useState("#f59e0b");
  const [savingStore, setSavingStore] = useState(false);
  const [storeSaved, setStoreSaved] = useState(false);

  const [paperWidth, setPaperWidth] = useState(store.receipt_paper_mm ?? 55);
  const [savingPaper, setSavingPaper] = useState(false);
  const [paperSaved, setPaperSaved] = useState(false);

  const [hoursEnabled, setHoursEnabled] = useState(false);
  const [opensAt, setOpensAt] = useState("08:00");
  const [closesAt, setClosesAt] = useState("18:00");
  const [openDays, setOpenDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [manuallyClosed, setManuallyClosed] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [hoursSaved, setHoursSaved] = useState(false);

  const [cashbackPercent, setCashbackPercent] = useState("");
  const [referralBonus, setReferralBonus] = useState("");
  const [silverThreshold, setSilverThreshold] = useState("");
  const [goldThreshold, setGoldThreshold] = useState("");
  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const [loyaltySaved, setLoyaltySaved] = useState(false);

  const [interestPercent, setInterestPercent] = useState("");
  const [savingInterest, setSavingInterest] = useState(false);
  const [interestSaved, setInterestSaved] = useState(false);

  const [salesGoal, setSalesGoal] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
  const [goalSaved, setGoalSaved] = useState(false);

  const [cardInterestEnabled, setCardInterestEnabled] = useState(false);
  const [cardInterestPercent, setCardInterestPercent] = useState("");
  const [savingCardInterest, setSavingCardInterest] = useState(false);
  const [cardInterestSaved, setCardInterestSaved] = useState(false);

  const [feePixPercent, setFeePixPercent] = useState("");
  const [feeCardPercent, setFeeCardPercent] = useState("");
  const [feeBoletoFixed, setFeeBoletoFixed] = useState("");
  const [savingFees, setSavingFees] = useState(false);
  const [feesSaved, setFeesSaved] = useState(false);

  const [accountantToken, setAccountantToken] = useState<string | null>(null);
  const [regeneratingToken, setRegeneratingToken] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const [alertLowStock, setAlertLowStock] = useState(true);
  const [alertStalledOrder, setAlertStalledOrder] = useState(true);
  const [alertDeliveryDelay, setAlertDeliveryDelay] = useState(true);
  const [alertGoalReached, setAlertGoalReached] = useState(true);
  const [weeklySummary, setWeeklySummary] = useState(true);
  const [alertNewComplaint, setAlertNewComplaint] = useState(true);
  const [alertBadReview, setAlertBadReview] = useState(true);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [alertsSaved, setAlertsSaved] = useState(false);

  const canDelete = confirmText.trim() === store.slug;

  useEffect(() => {
    getSupabase()
      .from("stores")
      .select(
        "business_hours_enabled, opens_at, closes_at, open_days, manually_closed, accountant_token, brand_color, accent_color, cashback_percent, referral_bonus, loyalty_silver_threshold, loyalty_gold_threshold, credit_interest_percent, sales_goal, alert_low_stock_enabled, alert_stalled_order_enabled, alert_delivery_delay_enabled, alert_goal_reached_enabled, weekly_summary_enabled, complaint_notification_enabled, card_installment_interest_enabled, card_installment_interest_percent, fee_pix_percent, fee_card_percent, fee_boleto_fixed, bad_review_notification_enabled",
      )
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
        if (data.accent_color) setAccentColor(data.accent_color);
        setCashbackPercent(data.cashback_percent > 0 ? String(data.cashback_percent) : "");
        setReferralBonus(data.referral_bonus > 0 ? String(data.referral_bonus) : "");
        setSilverThreshold(data.loyalty_silver_threshold > 0 ? String(data.loyalty_silver_threshold) : "");
        setGoldThreshold(data.loyalty_gold_threshold > 0 ? String(data.loyalty_gold_threshold) : "");
        setInterestPercent(data.credit_interest_percent > 0 ? String(data.credit_interest_percent) : "");
        setSalesGoal(data.sales_goal > 0 ? String(data.sales_goal) : "");
        setAlertLowStock(data.alert_low_stock_enabled);
        setAlertStalledOrder(data.alert_stalled_order_enabled);
        setAlertDeliveryDelay(data.alert_delivery_delay_enabled);
        setAlertGoalReached(data.alert_goal_reached_enabled);
        setWeeklySummary(data.weekly_summary_enabled);
        setAlertNewComplaint(data.complaint_notification_enabled);
        setCardInterestEnabled(data.card_installment_interest_enabled);
        setCardInterestPercent(data.card_installment_interest_percent > 0 ? String(data.card_installment_interest_percent) : "");
        setFeePixPercent(data.fee_pix_percent > 0 ? String(data.fee_pix_percent) : "");
        setFeeCardPercent(data.fee_card_percent > 0 ? String(data.fee_card_percent) : "");
        setFeeBoletoFixed(data.fee_boleto_fixed > 0 ? String(data.fee_boleto_fixed) : "");
        setAlertBadReview(data.bad_review_notification_enabled);
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
      .update({
        name: name.trim(),
        whatsapp: whatsapp.trim() || null,
        cnpj: cnpj.trim() || null,
        brand_color: brandColor,
        accent_color: accentColor,
      })
      .eq("id", store.id);
    setSavingStore(false);
    if (!updateError) {
      setStoreSaved(true);
      setTimeout(() => window.location.reload(), 600);
    }
  }

  function handleTestPrint() {
    const html = buildReceiptHtml({
      storeName: name || store.name,
      whatsapp: whatsapp || null,
      cnpj: cnpj || null,
      paperMm: paperWidth,
      items: [
        { name: "Produto de teste", qtyLabel: "2", lineTotal: 15 },
        { name: "Outro produto", qtyLabel: "1", lineTotal: 8.5 },
      ],
      total: 23.5,
      paymentLines: ["Pagamento: Dinheiro"],
      troco: 6.5,
    });
    printHtml(html);
  }

  async function handleSavePaper(e: FormEvent) {
    e.preventDefault();
    setSavingPaper(true);
    setPaperSaved(false);
    const { error: updateError } = await getSupabase()
      .from("stores")
      .update({ receipt_paper_mm: paperWidth })
      .eq("id", store.id);
    setSavingPaper(false);
    if (!updateError) {
      setPaperSaved(true);
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

  async function handleSaveLoyalty(e: FormEvent) {
    e.preventDefault();
    const percent = Number(cashbackPercent.replace(",", ".")) || 0;
    const bonus = Number(referralBonus.replace(",", ".")) || 0;
    const silver = Number(silverThreshold.replace(",", ".")) || 0;
    const gold = Number(goldThreshold.replace(",", ".")) || 0;
    if (percent < 0 || percent > 100 || bonus < 0 || silver < 0 || gold < 0) return;
    setSavingLoyalty(true);
    await getSupabase()
      .from("stores")
      .update({
        cashback_percent: percent,
        referral_bonus: bonus,
        loyalty_silver_threshold: silver,
        loyalty_gold_threshold: gold,
      })
      .eq("id", store.id);
    setSavingLoyalty(false);
    setLoyaltySaved(true);
    setTimeout(() => setLoyaltySaved(false), 2500);
  }

  async function handleSaveInterest(e: FormEvent) {
    e.preventDefault();
    const value = Number(interestPercent.replace(",", ".")) || 0;
    if (value < 0) return;
    setSavingInterest(true);
    await getSupabase().from("stores").update({ credit_interest_percent: value }).eq("id", store.id);
    setSavingInterest(false);
    setInterestSaved(true);
    setTimeout(() => setInterestSaved(false), 2500);
  }

  async function handleSaveCardInterest(enabled: boolean, percentText: string) {
    const percent = Number(percentText.replace(",", ".")) || 0;
    if (percent < 0) return;
    setSavingCardInterest(true);
    await getSupabase()
      .from("stores")
      .update({ card_installment_interest_enabled: enabled, card_installment_interest_percent: percent })
      .eq("id", store.id);
    setSavingCardInterest(false);
    setCardInterestSaved(true);
    setTimeout(() => setCardInterestSaved(false), 2500);
  }

  async function handleSaveFees(e: FormEvent) {
    e.preventDefault();
    const pix = Number(feePixPercent.replace(",", ".")) || 0;
    const card = Number(feeCardPercent.replace(",", ".")) || 0;
    const boleto = Number(feeBoletoFixed.replace(",", ".")) || 0;
    if (pix < 0 || card < 0 || boleto < 0) return;
    setSavingFees(true);
    await getSupabase()
      .from("stores")
      .update({ fee_pix_percent: pix, fee_card_percent: card, fee_boleto_fixed: boleto })
      .eq("id", store.id);
    setSavingFees(false);
    setFeesSaved(true);
    setTimeout(() => setFeesSaved(false), 2500);
  }

  async function handleSaveGoal(e: FormEvent) {
    e.preventDefault();
    const value = Number(salesGoal.replace(",", ".")) || 0;
    if (value < 0) return;
    setSavingGoal(true);
    await getSupabase().from("stores").update({ sales_goal: value }).eq("id", store.id);
    setSavingGoal(false);
    setGoalSaved(true);
    setTimeout(() => setGoalSaved(false), 2500);
  }

  async function handleSaveAlerts(e: FormEvent) {
    e.preventDefault();
    setSavingAlerts(true);
    setAlertsSaved(false);
    const { error: updateError } = await getSupabase()
      .from("stores")
      .update({
        alert_low_stock_enabled: alertLowStock,
        alert_stalled_order_enabled: alertStalledOrder,
        alert_delivery_delay_enabled: alertDeliveryDelay,
        alert_goal_reached_enabled: alertGoalReached,
        weekly_summary_enabled: weeklySummary,
        complaint_notification_enabled: alertNewComplaint,
        bad_review_notification_enabled: alertBadReview,
      })
      .eq("id", store.id);
    setSavingAlerts(false);
    if (!updateError) {
      setAlertsSaved(true);
      setTimeout(() => setAlertsSaved(false), 2000);
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
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">⚙️ Configurações</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Tudo que você pode ajustar manualmente na sua loja, num lugar só.
      </p>

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
            <label className="block text-sm text-slate-600 dark:text-slate-400">CNPJ (opcional)</label>
            <input
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0001-00"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
              Aparece no cupom impresso do PDV, junto com nome e WhatsApp.
            </p>
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">
              Cor da loja (identidade)
            </label>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
              Usada no cabeçalho da vitrine — o texto em cima se ajusta sozinho pra ficar legível.
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
                style={{ backgroundColor: brandColor, color: previewTextColor(brandColor) }}
              >
                Prévia
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">
              Cor de destaque (botões)
            </label>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
              Usada nos botões de ação da vitrine (adicionar ao carrinho, finalizar pedido) — vale a
              pena escolher uma cor que contraste com a de cima.
            </p>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
              />
              <span
                className="rounded-lg px-3 py-1.5 text-sm font-semibold"
                style={{ backgroundColor: accentColor, color: previewTextColor(accentColor) }}
              >
                Adicionar
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
        onSubmit={handleSavePaper}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          🖨️ Impressão do cupom (PDV)
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Largura da bobina da sua impressora térmica. Errado aqui faz o cupom sair torto ou
          desperdiçar papel.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PAPER_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setPaperWidth(w)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                paperWidth === w
                  ? "border-blue-900 bg-blue-900 text-amber-300 dark:border-blue-700 dark:bg-blue-800"
                  : "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300"
              }`}
            >
              {w}mm
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={savingPaper}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingPaper ? "Salvando…" : "Salvar"}
          </button>
          <button
            type="button"
            onClick={handleTestPrint}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            🖨️ Testar impressão
          </button>
          {paperSaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          Se o teste sair certinho aqui mas na hora da venda continuar imprimindo a bobina toda: o
          problema é a configuração da impressora no Windows, não desse site. Vá em{" "}
          <strong>Painel de Controle → Dispositivos e Impressoras</strong>, clique com o botão direito
          na sua impressora térmica → <strong>Preferências de impressão</strong>, e troque o tamanho do
          papel de &quot;A4&quot; ou &quot;Carta&quot; pra uma opção de bobina/recibo (geralmente chamada
          &quot;Roll paper&quot; ou o tamanho exato em mm). O navegador só consegue pedir o tamanho —
          quem decide de verdade é essa configuração do Windows.
        </p>
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

      <form
        onSubmit={handleSaveLoyalty}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Cashback, indicação e fidelidade
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Cashback (%)</label>
            <input
              value={cashbackPercent}
              onChange={(e) => setCashbackPercent(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Bônus por indicação (R$)</label>
            <input
              value={referralBonus}
              onChange={(e) => setReferralBonus(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Nível Prata a partir de (R$)</label>
            <input
              value={silverThreshold}
              onChange={(e) => setSilverThreshold(e.target.value)}
              placeholder="0 = desativado"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Nível Ouro a partir de (R$)</label>
            <input
              value={goldThreshold}
              onChange={(e) => setGoldThreshold(e.target.value)}
              placeholder="0 = desativado"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          Extrato de saldo e clientes por nível continuam em Cashback.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={savingLoyalty}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingLoyalty ? "Salvando…" : "Salvar"}
          </button>
          {loyaltySaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
      </form>

      <form
        onSubmit={handleSaveInterest}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Juros do crediário (%)
        </h2>
        <input
          value={interestPercent}
          onChange={(e) => setInterestPercent(e.target.value)}
          placeholder="0"
          inputMode="decimal"
          className="mt-2 w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Lista de clientes fiado continua em Fiado.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={savingInterest}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingInterest ? "Salvando…" : "Salvar"}
          </button>
          {interestSaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
      </form>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Juros no parcelamento do cartão
            </h2>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
              Hoje o cliente parcela sem juros. Se ligar, cada parcela extra soma esse % ao total.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCardInterestEnabled((prev) => {
                handleSaveCardInterest(!prev, cardInterestPercent);
                return !prev;
              });
            }}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${cardInterestEnabled ? "bg-blue-900 dark:bg-blue-700" : "bg-slate-300 dark:bg-slate-700"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${cardInterestEnabled ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
        {cardInterestEnabled && (
          <div className="mt-3 flex items-center gap-2">
            <input
              value={cardInterestPercent}
              onChange={(e) => setCardInterestPercent(e.target.value)}
              onBlur={() => handleSaveCardInterest(cardInterestEnabled, cardInterestPercent)}
              placeholder="0"
              inputMode="decimal"
              className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">% por parcela extra</span>
            {savingCardInterest && <span className="text-xs text-slate-400">salvando…</span>}
            {cardInterestSaved && <span className="text-sm text-green-600">Salvo!</span>}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSaveFees}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Taxas da maquininha/gateway
        </h2>
        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
          Preenche com o que a PagBank/Efí cobra, só pra você acompanhar o custo — não afeta o valor cobrado do cliente.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400">Pix (%)</label>
            <input
              value={feePixPercent}
              onChange={(e) => setFeePixPercent(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400">Cartão (%)</label>
            <input
              value={feeCardPercent}
              onChange={(e) => setFeeCardPercent(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400">Boleto (R$ fixo)</label>
            <input
              value={feeBoletoFixed}
              onChange={(e) => setFeeBoletoFixed(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={savingFees}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingFees ? "Salvando…" : "Salvar"}
          </button>
          {feesSaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
      </form>

      <form
        onSubmit={handleSaveGoal}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Meta de vendas do mês (R$)
        </h2>
        <input
          value={salesGoal}
          onChange={(e) => setSalesGoal(e.target.value)}
          placeholder="0 = desativado"
          inputMode="decimal"
          className="mt-2 w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          A barra de progresso fica em Relatórios.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={savingGoal}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingGoal ? "Salvando…" : "Salvar"}
          </button>
          {goalSaved && <span className="text-sm text-green-600">Salvo!</span>}
        </div>
      </form>

      <form
        onSubmit={handleSaveAlerts}
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Alertas automáticos
        </h2>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Manda notificação push (mesmo com o painel fechado) quando alguma dessas situações acontecer. Precisa ter ativado as notificações push no navegador.
        </p>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={alertLowStock}
              onChange={(e) => setAlertLowStock(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Estoque baixo (produto chegou no limite cadastrado)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={alertStalledOrder}
              onChange={(e) => setAlertStalledOrder(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Pedido parado sem confirmar há mais de 20 minutos
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={alertDeliveryDelay}
              onChange={(e) => setAlertDeliveryDelay(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Entrega a caminho há mais de 45 minutos
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={alertGoalReached}
              onChange={(e) => setAlertGoalReached(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Meta de vendas do mês batida (defina a meta mais abaixo)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={alertNewComplaint}
              onChange={(e) => setAlertNewComplaint(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Nova reclamação de cliente
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={alertBadReview}
              onChange={(e) => setAlertBadReview(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Avaliação ruim (nota 1 ou 2 na loja)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={weeklySummary}
              onChange={(e) => setWeeklySummary(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Resumo da semana toda segunda de manhã
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={savingAlerts}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60 dark:bg-blue-800"
          >
            {savingAlerts ? "Salvando…" : "Salvar"}
          </button>
          {alertsSaved && <span className="text-sm text-green-600">Salvo!</span>}
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
