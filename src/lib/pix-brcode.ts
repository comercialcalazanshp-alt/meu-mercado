// Gera o payload Pix "BR Code" (padrão EMV/BACEN) que qualquer QR code Pix
// usa por baixo — o mesmo formato que qualquer banco gera, sem precisar de
// processador de pagamento nem CPF do pagador. Só texto, sem chamada de rede.

function tlv(id: string, value: string) {
  const length = value.length.toString().padStart(2, "0");
  return `${id}${length}${value}`;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "");
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — exigido pelo padrão BR Code,
// calculado sobre o payload inteiro já incluindo o prefixo fixo "6304".
function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildPixBRCode(params: {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amount: number;
  txid?: string;
}): string {
  const merchantName = normalize(params.merchantName).toUpperCase().slice(0, 25) || "LOJA";
  const merchantCity = normalize(params.merchantCity).toUpperCase().slice(0, 15) || "BRASIL";
  const txidClean = (params.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  const txid = txidClean || "***";

  const merchantAccountInfo = tlv("00", "br.gov.bcb.pix") + tlv("01", params.pixKey.trim());
  const additionalData = tlv("05", txid);

  let payload =
    tlv("00", "01") +
    tlv("26", merchantAccountInfo) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", params.amount.toFixed(2)) +
    tlv("58", "BR") +
    tlv("59", merchantName) +
    tlv("60", merchantCity) +
    tlv("62", additionalData);

  payload += "6304";
  return payload + crc16(payload);
}
