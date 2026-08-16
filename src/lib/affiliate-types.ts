// Tipos das tabelas do Hub de Afiliados (schema-v73.sql). Espelham as
// colunas do banco 1:1 — se a migração mudar, atualizar aqui junto.

export type PayoutMethod = "manual" | "split_automatico";
export type PayoutSpeed = "48h" | "72h" | "semanal";
export type PlanType = "padrao" | "personalizado";
export type BillingCycle = "mensal" | "trimestral" | "semestral" | "anual";
export type AiImageKind = "gerada" | "editada";
export type SettlementType = "venda" | "repasse" | "estorno";

export type AffiliatePartnership = {
  id: string;
  hub_store_id: string;
  module_store_id: string;
  category: string;
  owner_name: string;
  tax_id: string;
  address: string;
  lat: number | null;
  lng: number | null;
  license_number: string | null;
  commission_percent: number;
  payout_method: PayoutMethod;
  payout_speed: PayoutSpeed | null;
  payout_pix_key: string | null;
  payout_bank_details: string | null;
  plan_type: PlanType;
  billing_cycle: BillingCycle;
  subscription_price: number | null;
  subscription_due_at: string | null;
  ai_quota_monthly: number | null;
  balance: number;
  contract_started_at: string;
  contract_notice_days: number | null;
  contract_ends_at: string | null;
  active: boolean;
  created_at: string;
};

export type AffiliateSettings = {
  id: string;
  hub_store_id: string;
  suggested_commission_percent: number;
  price_monthly: number;
  price_quarterly: number;
  price_semiannual: number;
  price_annual: number;
  anticipation_fee_48h_percent: number;
  anticipation_fee_72h_percent: number;
  upload_min_resolution_px: number;
  upload_aspect_ratio: string;
  upload_max_size_mb: number;
  ai_quota_monthly_default: number;
  created_at: string;
};

export type AffiliateExtra = {
  id: string;
  hub_store_id: string;
  code: string;
  name: string;
  price_monthly: number;
  included_in_padrao: boolean;
  active: boolean;
  created_at: string;
};

export type AffiliatePartnershipExtra = {
  id: string;
  partnership_id: string;
  extra_id: string;
  enabled: boolean;
  price_override: number | null;
  created_at: string;
};

export type AffiliateAiPackage = {
  id: string;
  hub_store_id: string;
  partnership_id: string | null;
  qty: number;
  price: number;
  is_custom: boolean;
  active: boolean;
  created_at: string;
};

export type AffiliateAiImageEvent = {
  id: string;
  partnership_id: string;
  kind: AiImageKind;
  created_at: string;
};

export type AffiliateAiPurchase = {
  id: string;
  partnership_id: string;
  package_id: string | null;
  image_qty: number;
  price: number;
  payment_method: string;
  pagbank_order_id: string | null;
  paid_at: string | null;
  created_at: string;
};

export type AffiliateSettlementTransaction = {
  id: string;
  partnership_id: string;
  type: SettlementType;
  amount: number;
  order_id: string | null;
  note: string | null;
  created_at: string;
};

export type AffiliateOrderStop = {
  id: string;
  order_id: string;
  store_id: string;
  address: string;
  lat: number | null;
  lng: number | null;
  picked_up_at: string | null;
  created_at: string;
};

// Colunas novas em "stores" (v73) — endereço estruturado, usado como ponto
// de retirada do módulo dono do hub. O tipo Store principal continua em
// src/lib/store-context.tsx; isso aqui é só o que a v73 acrescentou.
export type StoreAddressFields = {
  address: string | null;
  lat: number | null;
  lng: number | null;
};
