import { supabase } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import { demoStore } from "./demoStore";
import type { TransactionType } from "../types";

/**
 * Client-side wrapper around Provibill (a bill payment/VTU aggregator —
 * see the "Provibill Test Public" Postman collection for the full flow:
 * Get Categories -> Get Bills by Category -> GetField -> Validate ->
 * Payment -> Payment Inquiry). All requests are proxied through the
 * `provibill-purchase` Supabase Edge Function, which holds the real
 * PROVIBILL_USERNAME / PROVIBILL_PASSWORD (Basic Auth) and talks to
 * Provibill's REST API. Keeping those credentials server-side is required
 * — they must never ship in frontend JS.
 *
 * Provibill replaces VTpass as the bill payment/VTU fulfillment provider.
 *
 * In demo mode (no Supabase configured yet), every call below short-
 * circuits into a simulated response and updates the local demo
 * wallet/transactions instead — see src/lib/demoStore.ts.
 *
 * REPLACE: nothing here — set PROVIBILL_BASE_URL / PROVIBILL_USERNAME /
 * PROVIBILL_PASSWORD / PROVIBILL_ACCOUNT_NO as Supabase function secrets.
 * The edge function looks up the right Provibill "bill" for each purchase
 * by matching names within a category live (see
 * supabase/functions/provibill-purchase/index.ts) — confirm those name
 * matches against your real sandbox data before going live, since the
 * collection we were given only showed full example field/response data
 * for the Electricity category.
 */

export type ProvibillService = "airtime" | "data" | "tv-subscription" | "electricity" | "exam-pin";

export interface ProvibillPurchasePayload {
  service: ProvibillService;
  serviceId: string; // network/disco/provider/exam-body id, e.g. "mtn", "ikeja", "dstv", "waec"
  variationCode?: string; // internal data plan / tv bouquet id, when applicable
  variationLabel?: string; // human-readable plan name (e.g. "1GB - 30 Days") — used to
  // match the right option inside Provibill's dynamic field list; pass this
  // whenever variationCode is set, since Provibill matches by display name,
  // not by our internal id.
  amount?: number;
  phone?: string;
  smartcardNumber?: string;
  meterNumber?: string;
  meterType?: "prepaid" | "postpaid";
  quantity?: number;
}

export interface ProvibillPurchaseResult {
  success: boolean;
  reference: string;
  message: string;
  raw?: unknown;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function purchase(payload: ProvibillPurchasePayload): Promise<ProvibillPurchaseResult> {
  if (isDemoMode) {
    await delay(900);
    const amount = payload.amount ?? 0;
    const reference = `MHU-${Date.now()}`;
    const wallet = demoStore.getWallet();
    if (amount > wallet.balance) {
      return { success: false, reference, message: "Insufficient wallet balance" };
    }
    demoStore.record(
      {
        type: payload.service.replace(/-/g, "_") as TransactionType,
        amount,
        status: "successful",
        reference,
        title: `${payload.service.replace(/-/g, " ")} purchase`,
      },
      -amount
    );
    return { success: true, reference, message: "Purchase successful" };
  }

  const { data, error } = await supabase.functions.invoke("provibill-purchase", {
    body: { action: "pay", ...payload },
  });
  if (error) throw new Error(error.message ?? "Purchase failed");
  return data as ProvibillPurchaseResult;
}

export async function verifyMeter(disco: string, meterNumber: string, meterType: "prepaid" | "postpaid") {
  if (isDemoMode) {
    await delay(500);
    return { customerName: "Chidinma Okafor", address: "12 Marina Street, Lagos" };
  }
  const { data, error } = await supabase.functions.invoke("provibill-purchase", {
    body: { action: "validate", service: "electricity", serviceId: disco, meterNumber, meterType },
  });
  if (error) throw new Error(error.message ?? "Meter verification failed");
  return data as { customerName: string; address?: string };
}

export async function verifySmartcard(provider: string, smartcardNumber: string) {
  if (isDemoMode) {
    await delay(500);
    return { customerName: "Chidinma Okafor", dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 20).toDateString() };
  }
  const { data, error } = await supabase.functions.invoke("provibill-purchase", {
    body: { action: "validate", service: "tv-subscription", serviceId: provider, smartcardNumber },
  });
  if (error) throw new Error(error.message ?? "Smartcard verification failed");
  return data as { customerName: string; dueDate?: string };
}
