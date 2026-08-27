import { supabase } from "./supabaseClient";
import { isDemoMode } from "./demoMode";

/**
 * Client-side wrapper around Smsala SMS. The actual Smsala API call happens
 * inside the `smsala-send-otp` Supabase Edge Function (see
 * supabase/functions/smsala-send-otp/index.ts) so the Smsala API token never
 * reaches the browser. This module just invokes that function.
 *
 * In demo mode, sendOtp/verifyOtp both auto-succeed (any 6-digit code is
 * accepted) so you can click through registration without a real SMS
 * provider configured.
 *
 * REPLACE: nothing here — set SMSALA_API_TOKEN / SMSALA_SENDER_ID as Supabase
 * function secrets (see .env.example) and the edge function will pick them up.
 */

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendOtp(phone: string) {
  if (isDemoMode) {
    await delay(400);
    return { success: true, requestId: `OTP-${Date.now()}` };
  }
  const { data, error } = await supabase.functions.invoke("smsala-send-otp", {
    body: { phone, action: "send" },
  });
  if (error) throw new Error(error.message ?? "Failed to send OTP");
  return data as { success: boolean; requestId: string };
}

export async function verifyOtp(phone: string, code: string) {
  if (isDemoMode) {
    await delay(400);
    return { success: code.trim().length > 0 };
  }
  const { data, error } = await supabase.functions.invoke("smsala-send-otp", {
    body: { phone, code, action: "verify" },
  });
  if (error) throw new Error(error.message ?? "Failed to verify OTP");
  return data as { success: boolean };
}
