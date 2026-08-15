"use server";

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const COOKIE_NAME = "admin_auth";

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
  const a = Buffer.from(password);
  const b = Buffer.from(expected ?? "");
  const matches = !!expected && a.length === b.length && timingSafeEqual(a, b);
  if (!matches) {
    return { error: "Senha incorreta." };
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
