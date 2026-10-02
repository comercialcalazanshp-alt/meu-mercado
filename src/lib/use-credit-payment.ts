"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";
import { buildCreditPaymentReceiptHtml, printHtml } from "@/lib/receipt";

export type PaymentMethod = "dinheiro" | "pix" | "cartao";

export const PAYMENT_METHODS: PaymentMethod[] = ["dinheiro", "pix", "cartao"];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao: "Cartão",
};

export type DiscountMode = "valor" | "percent";

type PayableCustomer = { id: string; name: string; balance: number };

type PaymentSuccess = {
  customerId: string;
  customerName: string;
  // o que o cliente de fato pagou (dinheiro/Pix/cartão que entrou)
  amount: number;
  // desconto dado na cobrança (0 quando não teve)
  discount: number;
  methodLabel: string;
  balanceBefore: number;
  balanceAfter: number;
};

function parseMoney(raw: string) {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  return cleaned === "" ? 0 : Number(cleaned);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

// "Valor a quitar" é quanto da dívida do cliente esse pagamento resolve.
// O desconto sai desse valor: se quita R$ 120 com 10% de desconto, o cliente
// paga R$ 108 e a dívida cai R$ 120 (R$ 108 de pagamento + R$ 12 de desconto).
// Usada também pela tela, pra mostrar "cliente paga" e gerar o QR Pix com o
// valor certo antes de confirmar.
export function computePaymentBreakdown(amountRaw: string, discountRaw: string, mode: DiscountMode) {
  const amount = round2(parseMoney(amountRaw));
  const input = parseMoney(discountRaw);
  let error: string | null = null;
  let discount = 0;

  if (!Number.isFinite(amount) || amount <= 0) {
    return { amount: 0, discount: 0, cash: 0, error: null as string | null };
  }
  if (!Number.isFinite(input) || input < 0) {
    error = "Digite um desconto válido.";
  } else {
    discount = round2(mode === "percent" ? (amount * input) / 100 : input);
    if (discount >= amount) {
      error = "O desconto precisa ser menor que o valor a quitar.";
      discount = 0;
    }
  }
  return { amount, discount, cash: round2(amount - discount), error };
}

// Única implementação de "receber pagamento de fiado" — usada tanto no
// Crediário quanto em Clientes, pra forma de pagamento e comprovante nunca
// mais ficarem diferentes entre as duas telas.
export function useCreditPayment(onPaid: (customerId: string) => void) {
  const store = useStore();
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("valor");
  const [method, setMethod] = useState<PaymentMethod>("dinheiro");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState<PaymentSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  const breakdown = computePaymentBreakdown(amount, discount, discountMode);

  function start(customerId: string) {
    setSuccess(null);
    setError(null);
    setMethod("dinheiro");
    setAmount("");
    setDiscount("");
    setDiscountMode("valor");
    setPayingId(customerId);
  }

  function cancel() {
    setPayingId(null);
    setError(null);
  }

  async function confirm(customer: PayableCustomer) {
    if (confirming) return;
    if (breakdown.amount <= 0) {
      setError("Digite o valor a quitar.");
      return;
    }
    if (breakdown.error) {
      setError(breakdown.error);
      return;
    }

    setError(null);
    setConfirming(true);

    // Pagamento (dinheiro que entrou) e desconto (dívida abatida sem entrar
    // dinheiro) vão numa chamada só — o banco grava os dois ou nenhum, pra
    // nunca ficar o pagamento registrado sem o desconto correspondente.
    const rows: Record<string, unknown>[] = [
      { customer_id: customer.id, type: "pagamento", amount: breakdown.cash, payment_method: method },
    ];
    if (breakdown.discount > 0) {
      const label =
        discountMode === "percent"
          ? `${discount.trim()}%`
          : breakdown.discount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      rows.push({
        customer_id: customer.id,
        type: "baixa",
        amount: breakdown.discount,
        note: `Desconto na cobrança (${label})`,
      });
    }
    const { error: txError } = await getSupabase().from("credit_transactions").insert(rows);
    setConfirming(false);
    if (txError) {
      setError("Não deu pra registrar o pagamento: " + txError.message);
      return;
    }

    setSuccess({
      customerId: customer.id,
      customerName: customer.name,
      amount: breakdown.cash,
      discount: breakdown.discount,
      methodLabel: PAYMENT_METHOD_LABELS[method],
      balanceBefore: customer.balance,
      balanceAfter: round2(customer.balance - breakdown.amount),
    });
    setAmount("");
    setDiscount("");
    setPayingId(null);
    onPaid(customer.id);
  }

  function printReceipt() {
    if (!success) return;
    printHtml(
      buildCreditPaymentReceiptHtml({
        storeName: store.name,
        whatsapp: store.whatsapp,
        cnpj: store.cnpj,
        paperMm: store.receipt_paper_mm || 55,
        customerName: success.customerName,
        amount: success.amount,
        discount: success.discount,
        paymentMethodLabel: success.methodLabel,
        balanceBefore: success.balanceBefore,
        balanceAfter: success.balanceAfter,
      }),
    );
  }

  // mexer em qualquer campo apaga o erro da tentativa anterior — senão a
  // mensagem velha fica na tela mesmo depois do valor ter sido corrigido.
  const clearAnd = <T,>(setter: (v: T) => void) => (v: T) => {
    setError(null);
    setter(v);
  };

  return {
    amount,
    setAmount: clearAnd(setAmount),
    discount,
    setDiscount: clearAnd(setDiscount),
    discountMode,
    setDiscountMode: clearAnd(setDiscountMode),
    breakdown,
    method,
    setMethod: clearAnd(setMethod),
    payingId,
    confirming,
    success,
    error,
    start,
    cancel,
    confirm,
    printReceipt,
  };
}
