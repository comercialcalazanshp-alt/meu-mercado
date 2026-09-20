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

type PayableCustomer = { id: string; name: string; balance: number };

type PaymentSuccess = {
  customerId: string;
  customerName: string;
  amount: number;
  methodLabel: string;
  balanceBefore: number;
  balanceAfter: number;
};

// Única implementação de "receber pagamento de fiado" — usada tanto no
// Crediário quanto em Clientes, pra forma de pagamento e comprovante nunca
// mais ficarem diferentes entre as duas telas.
export function useCreditPayment(onPaid: (customerId: string) => void) {
  const store = useStore();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("dinheiro");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState<PaymentSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  function start(customerId: string) {
    setSuccess(null);
    setError(null);
    setMethod("dinheiro");
    setAmount("");
    setPayingId(customerId);
  }

  function cancel() {
    setPayingId(null);
    setError(null);
  }

  async function confirm(customer: PayableCustomer) {
    if (confirming) return;
    const value = Number(amount.replace(",", "."));
    if (Number.isNaN(value) || value <= 0) {
      setError("Digite o valor pago.");
      return;
    }

    setError(null);
    setConfirming(true);
    const { error: txError } = await getSupabase().from("credit_transactions").insert({
      customer_id: customer.id,
      type: "pagamento",
      amount: value,
      payment_method: method,
    });
    setConfirming(false);
    if (txError) {
      setError("Não deu pra registrar o pagamento: " + txError.message);
      return;
    }

    setSuccess({
      customerId: customer.id,
      customerName: customer.name,
      amount: value,
      methodLabel: PAYMENT_METHOD_LABELS[method],
      balanceBefore: customer.balance,
      balanceAfter: customer.balance - value,
    });
    setAmount("");
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
        paymentMethodLabel: success.methodLabel,
        balanceBefore: success.balanceBefore,
        balanceAfter: success.balanceAfter,
      }),
    );
  }

  return { amount, setAmount, method, setMethod, payingId, confirming, success, error, start, cancel, confirm, printReceipt };
}
