export type ReceiptItem = {
  name: string;
  qtyLabel: string;
  lineTotal: number;
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function buildReceiptHtml(params: {
  storeName: string;
  whatsapp?: string | null;
  cnpj?: string | null;
  paperMm: number;
  items: ReceiptItem[];
  subtotal?: number;
  discount?: number;
  total: number;
  paymentLines: string[];
  troco?: number | null;
}) {
  const { storeName, whatsapp, cnpj, paperMm, items, subtotal, discount, total, paymentLines, troco } = params;

  const itemsHtml = items
    .map(
      (item) =>
        `<tr><td>${item.qtyLabel} ${item.name}</td><td class="r">${formatCurrency(item.lineTotal)}</td></tr>`,
    )
    .join("");

  const discountHtml =
    discount && discount > 0
      ? `<p class="row"><span>Subtotal</span><span>${formatCurrency(subtotal ?? total + discount)}</span></p>
         <p class="row"><span>Desconto</span><span>-${formatCurrency(discount)}</span></p>`
      : "";

  const paymentHtml = paymentLines.map((line) => `<p class="row"><span>${line}</span></p>`).join("");

  const headerHtml = [
    `<h2>${storeName}</h2>`,
    whatsapp ? `<p class="center">${whatsapp}</p>` : "",
    cnpj ? `<p class="center">CNPJ ${cnpj}</p>` : "",
  ]
    .filter(Boolean)
    .join("");

  // Tamanho de bobina térmica com altura automática — sem isso o navegador
  // usa o tamanho de folha padrão (A4/Carta) e desperdiça bobina imprimindo
  // uma página inteira pra um cupom pequeno. Texto em negrito e maior porque
  // fontes finas saem fracas na cabeça de impressão térmica.
  return `
    <html><head><title>Recibo</title>
    <style>
      @page { size: ${paperMm}mm auto; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body{font-family:'Courier New',monospace;font-weight:700;width:${paperMm}mm;margin:0;padding:3mm 2mm;font-size:12px;color:#000;}
      h2{margin:0 0 1mm;font-size:15px;text-align:center;letter-spacing:0.5px;}
      p{margin:1mm 0;}
      .center{text-align:center;}
      .muted{font-size:10px;text-align:center;font-weight:400;}
      .divider{border-top:1px dashed #000;margin:2mm 0;}
      table{width:100%;border-collapse:collapse;margin-top:1mm;}
      td{padding:0.8mm 0;font-size:12px;vertical-align:top;}
      td.r{text-align:right;white-space:nowrap;padding-left:2mm;}
      .row{display:flex;justify-content:space-between;font-size:12px;}
      .total{font-size:15px;border-top:2px solid #000;margin-top:2mm;padding-top:2mm;display:flex;justify-content:space-between;}
      .footer{margin-top:3mm;text-align:center;font-size:10px;font-weight:400;}
    </style></head><body>
    ${headerHtml}
    <p class="muted">${new Date().toLocaleString("pt-BR")}</p>
    <p class="muted">Cupom não fiscal</p>
    <div class="divider"></div>
    <table><tbody>${itemsHtml}</tbody></table>
    <div class="divider"></div>
    ${discountHtml}
    <p class="total"><span>Total</span><span>${formatCurrency(total)}</span></p>
    <div class="divider"></div>
    ${paymentHtml}
    ${troco !== null && troco !== undefined ? `<p class="row"><span>Troco</span><span>${formatCurrency(Math.max(0, troco))}</span></p>` : ""}
    <p class="footer">Obrigado pela preferência!</p>
    </body></html>
  `;
}

// Usa um iframe escondido em vez de window.open: abrir aba/janela nova é
// bloqueado por popup blocker em muitos celulares e navegadores, e falhava
// em silêncio (sem imprimir e sem avisar nada). Imprimir dentro da própria
// página não é bloqueado.
export function printHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 200);
}
