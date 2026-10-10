import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import { demoStore } from "./demoStore";
import { TV_PLANS } from "../data/reference";
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
 * As of Oct 2026, VTpass is back to handling Airtime and Data again
 * (reverted from a brief switch to Hadjibs Data, now retired) alongside
 * Cable TV, Electricity, and Exam Pins -- every subscriber product.
 *
 * In demo mode (no Supabase configured yet), every call below short-
 * circuits into a simulated response and updates the local demo
 * wallet/transactions instead — see src/lib/demoStore.ts.
 */

export type VtpassService = "airtime" | "data" | "tv-subscription" | "electricity" | "exam-pin";

export interface VtpassPurchasePayload {
  service: VtpassService;
  serviceId: string; // e.g. "dstv", "ikeja-electric", "waec"
  variationCode?: string; // tv bouquet code, when applicable
  variationLabel?: string; // human-readable bouquet name (unused by VTpass, kept so callers don't need edits)
  amount?: number; // required for electricity (customer-entered amount)
  phone?: string; // required by VTpass on every purchase, even when not the actual recipient
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
 * Real VTpass bouquet/data-plan variation codes for a given provider/network
 * -- fetched live via GET /service-variations rather than hardcoded
 * placeholder ids (VTpass rejects made-up codes as invalid). Covers both TV
 * bouquets (serviceId = "dstv" etc.) and data plans (serviceId = "mtn" etc.
 * -- the edge function maps that to the real "mtn-data" VTpass serviceID,
 * see DATA_IDS in vtpass-purchase/index.ts).
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
    // No static demo-mode data-plan list -- a handful of made-up plans is
    // enough to exercise the UI without needing a real catalog in demo mode.
    return [
      { code: `${serviceId}-500mb`, name: "500MB - 30 Days", price: 500 },
      { code: `${serviceId}-1gb`, name: "1GB - 30 Days", price: 1000 },
      { code: `${serviceId}-5gb`, name: "5GB - 30 Days", price: 3500 },
    ];
  }
  const { data, error } = await supabase.functions.invoke("vtpass-purchase", {
    body: { action: "variations", service, serviceId },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return (data as { variations: VtpassVariation[] }).variations;
}
