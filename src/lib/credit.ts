export function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatDateOnly(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

// Data local (não UTC): à noite no Brasil o toISOString() já cai no dia
// seguinte e o vencimento sugerido saía com 1 dia a mais.
export function defaultDueDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isOverdue(dueDate: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate + "T00:00:00") < today;
}

export function calcInterest(amount: number, dueDate: string, monthlyRate: number) {
  if (monthlyRate <= 0 || !isOverdue(dueDate)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const daysLate = Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return amount * (monthlyRate / 100) * (daysLate / 30);
}

export type CollectionStats = {
  avgDays: number | null;
  paymentsCount: number;
  dailyFiadoRate: number;
  recommendedReserve: number;
};

type StatsTx = { customer_id: string; type: string; amount: number | string; created_at: string };

// Prazo médio de recebimento do fiado — não vem de estimativa, é medido de
// verdade: casa cada pagamento com a(s) venda(s) fiado mais antiga(s)
// daquele cliente que ainda estavam em aberto (FIFO, tipo fila), calcula
// quantos dias se passaram entre a venda e o pagamento, e faz a média
// ponderada pelo valor. Com isso dá pra recomendar quanto guardar de
// reserva pra girar o fiado sem aperto: ritmo diário de venda fiado ×
// prazo combinado com os clientes (não a média medida, que fica instável
// com poucos pagamentos registrados).
export function computeCollectionStats(txs: StatsTx[], creditTermDays: number): CollectionStats {
  const byCustomer = new Map<string, StatsTx[]>();
  for (const t of txs) {
    if (!byCustomer.has(t.customer_id)) byCustomer.set(t.customer_id, []);
    byCustomer.get(t.customer_id)!.push(t);
  }

  let weightedDaysSum = 0;
  let collectedAmountSum = 0;
  let paymentsCount = 0;

  for (const custTxs of byCustomer.values()) {
    const queue: { date: string; remaining: number }[] = [];
    for (const t of custTxs) {
      if (t.type === "venda" || t.type === "juros") {
        queue.push({ date: t.created_at, remaining: Number(t.amount) });
      } else if (t.type === "pagamento" || t.type === "baixa") {
        let toConsume = Number(t.amount);
        if (t.type === "pagamento") paymentsCount += 1;
        while (toConsume > 0.001 && queue.length > 0) {
          const oldest = queue[0];
          const consumed = Math.min(oldest.remaining, toConsume);
          if (t.type === "pagamento") {
            const days = (new Date(t.created_at).getTime() - new Date(oldest.date).getTime()) / (1000 * 60 * 60 * 24);
            weightedDaysSum += days * consumed;
            collectedAmountSum += consumed;
          }
          oldest.remaining -= consumed;
          toConsume -= consumed;
          if (oldest.remaining <= 0.001) queue.shift();
        }
      }
    }
  }

  const avgDays = collectedAmountSum > 0 ? weightedDaysSum / collectedAmountSum : null;

  // ritmo diário: soma das vendas fiado nos últimos até 30 dias (ou desde a
  // primeira venda, se a loja tiver menos tempo de uso que isso).
  const vendaTxs = txs.filter((t) => t.type === "venda");
  let dailyFiadoRate = 0;
  if (vendaTxs.length > 0) {
    const firstDate = Math.min(...vendaTxs.map((t) => new Date(t.created_at).getTime()));
    const daysSpan = Math.max(1, (Date.now() - firstDate) / (1000 * 60 * 60 * 24));
    const window = Math.min(daysSpan, 30);
    const cutoff = Date.now() - window * 24 * 60 * 60 * 1000;
    const recentTotal = vendaTxs
      .filter((t) => new Date(t.created_at).getTime() >= cutoff)
      .reduce((s, t) => s + Number(t.amount), 0);
    dailyFiadoRate = recentTotal / window;
  }

  return { avgDays, paymentsCount, dailyFiadoRate, recommendedReserve: dailyFiadoRate * creditTermDays };
}
