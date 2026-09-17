"use server";

import { cookies, headers } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const COOKIE_NAME = "admin_auth";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

async function callerIdentifier(): Promise<string> {
  const h = await headers();
  // x-forwarded-for pode vir com vários IPs separados por vírgula (cadeia de
  // proxies) — o primeiro é o cliente de verdade.
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "sem-ip";
}

function computeToken(password: string) {
  return createHmac("sha256", password).update("meu-mercado-admin-session").digest("hex");
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;

  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return false;

  const expectedToken = computeToken(expected);
  const a = Buffer.from(token);
  const b = Buffer.from(expectedToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function adminLogin(password: string): Promise<{ error?: string }> {
  const expected = process.env.ADMIN_PASSWORD;
  const identifier = await callerIdentifier();
  const admin = getSupabaseAdmin();

  const { data: attempt } = await admin
    .from("admin_login_attempts")
    .select("failed_count, locked_until")
    .eq("identifier", identifier)
    .maybeSingle();

  if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
    return { error: "Muitas tentativas erradas. Tenta de novo em alguns minutos." };
  }

  const a = Buffer.from(password);
  const b = Buffer.from(expected ?? "");
  const matches = !!expected && a.length === b.length && timingSafeEqual(a, b);

  if (!matches) {
    const nextCount = (attempt?.failed_count ?? 0) + 1;
    await admin.from("admin_login_attempts").upsert({
      identifier,
      failed_count: nextCount,
      last_attempt_at: new Date().toISOString(),
      locked_until: nextCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
    });
    return { error: "Senha incorreta." };
  }

  if (attempt) {
    await admin.from("admin_login_attempts").delete().eq("identifier", identifier);
  }

  (await cookies()).set(COOKIE_NAME, computeToken(expected), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/admin",
    maxAge: 60 * 60 * 24 * 30,
  });
  return {};
}

export async function adminLogout() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function toggleStoreActive(storeId: string, active: boolean) {
  if (!(await isAdminAuthenticated())) {
    throw new Error("Não autorizado");
  }
  await getSupabaseAdmin().from("stores").update({ active }).eq("id", storeId);
}

export async function updateStorePlan(storeId: string, planId: string) {
  if (!(await isAdminAuthenticated())) {
    throw new Error("Não autorizado");
  }
  await getSupabaseAdmin().from("stores").update({ plan_id: planId }).eq("id", storeId);
}

export async function updateSupportRequestStatus(requestId: string, status: "aberto" | "respondido") {
  if (!(await isAdminAuthenticated())) {
    throw new Error("Não autorizado");
  }
  await getSupabaseAdmin().from("support_requests").update({ status }).eq("id", requestId);
}
