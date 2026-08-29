import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import { demoStore } from "./demoStore";
import { TV_PLANS, DATA_PLANS } from "../data/reference";
import type { TransactionType } from "../types";

/**
 * Client-side wrapper around VTpass (see https://vtpass.com/documentation
 * for the full API reference — auth, pay/requery/merchant-verify/
 * service-variations endpoints all confirmed against their live docs).
 * All requests are proxied through the `vtpass-purchase` Supabase Edge
 * Function, which holds the real VTPASS_API_KEY / VTPASS_SECRET_KEY /
 * VTPASS_PUBLIC_KEY and talks to VTpass's REST API. Keeping those
 * credentials server-side is required — they must never ship in frontend
 * JS.
 *
 * VTpass replaces Provibill as the bill payment/VTU fulfillment provider
 * (Provibill's sandbox was never reachable due to an unresolved bank-side
 * firewall/whitelisting issue — see README for details. Provibill's files
 * are left in place, unused, in case that gets resolved later).
 *
 * In demo mode (no Supabase configured yet), every call below short-
 * circuits into a simulated response and updates the local demo
 * wallet/transactions instead — see src/lib/demoStore.ts.
 */

export type VtpassService = "airtime" | "data" | "tv-subscription" | "electricity" | "exam-pin";

export interface VtpassPurchasePayload {
  service: VtpassService;
  serviceId: string; // e.g. "mtn", "dstv", "ikeja-electric", "waec"
  variationCode?: string; // data plan / tv bouquet code, when applicable
  variationLabel?: string; // human-readable plan/bouquet name (unused by VTpass, kept so callers don't need edits)
  amount?: number; // required for airtime + electricity (customer-entered amount)
  phone?: string; // airtime / data recipient, and required by VTpass on every purchase
  smartcardNumber?: string; // tv subscription
  meterNumber?: string; // electricity
  meterType?: "prepaid" | "postpaid";
  quantity?: number; // exam pins
}

export interface VtpassPurchaseResult {
  success: boolean;
  reference: string;
  message: string;
  raw?: unknown;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function purchase(payload: VtpassPurchasePayload): Promise<VtpassPurchaseResult> {
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

  const { data, error } = await supabase.functions.invoke("vtpass-purchase", {
    body: { action: "pay", ...payload },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as VtpassPurchaseResult;
}

export async function verifyMeter(disco: string, meterNumber: string, meterType: "prepaid" | "postpaid") {
  if (isDemoMode) {
    await delay(500);
    return { customerName: "Chidinma Okafor", address: "12 Marina Street, Lagos" };
  }
  const { data, error } = await supabase.functions.invoke("vtpass-purchase", {
    body: { action: "verify", service: "electricity", serviceId: disco, meterNumber, meterType },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as { customerName: string; address?: string };
}

export async function verifySmartcard(provider: string, smartcardNumber: string) {
  if (isDemoMode) {
    await delay(500);
    return { customerName: "Chidinma Okafor", dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 20).toDateString() };
  }
  const { data, error } = await supabase.functions.invoke("vtpass-purchase", {
    body: { action: "verify", service: "tv-subscription", serviceId: provider, smartcardNumber },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as { customerName: string; dueDate?: string };
}

/**
 * Real VTpass variation codes (data plans / TV bouquets) for a given
 * network/provider -- fetched live via GET /service-variations rather than
 * the hardcoded placeholder ids in src/data/reference.ts (those were only
 * ever meant to build the UI against; VTpass rejects them as invalid).
 */
export interface VtpassVariation {
  code: string;
  name: string;
  price: number;
}

export async function getVariations(
  service: "data" | "tv-subscription",
  serviceId: string
): Promise<VtpassVariation[]> {
  if (isDemoMode) {
    await delay(400);
    if (service === "tv-subscription") {
      return TV_PLANS.filter((p) => p.provider === serviceId).map((p) => ({
        code: p.id,
        name: p.name,
        price: p.price,
      }));
    }
    return DATA_PLANS.filter((p) => p.network === serviceId).map((p) => ({
      code: p.id,
      name: `${p.size} - ${p.validity}`,
      price: p.price,
    }));
  }
  const { data, error } = await supabase.functions.invoke("vtpass-purchase", {
    body: { action: "variations", service, serviceId },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return (data as { variations: VtpassVariation[] }).variations;
}
