import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import { demoStore } from "./demoStore";
import { HADJIBS_DATA_PLANS } from "../data/hadjibsDataPlans";
import type { TransactionType } from "../types";

/**
 * Client-side wrapper around Hadjibs Data (hadjibsdata.com.ng) -- the
 * mobile-network subscriber provider (airtime + data) as of Oct 2026,
 * replacing VTpass for those two products specifically. Cable TV,
 * Electricity, and Exam Pins are NOT offered via Hadjibs' public API (only
 * /api/user, /api/data, /api/airtime exist -- confirmed directly against
 * the account's own logged-in API docs page), so those three stay on
 * VTpass -- see src/lib/vtpass.ts, still used by Tv.tsx/Electricity.tsx/
 * ExamPins.tsx.
 *
 * All requests are proxied through the `hadjibs-purchase` Supabase Edge
 * Function, which holds the real HADJIBS_API_KEY (a single key -- Hadjibs
 * has no separate secret/public key split) and talks to Hadjibs' REST API.
 * Keeping that credential server-side is required -- it must never ship in
 * frontend JS.
 *
 * In demo mode (no Supabase configured yet), every call below short-
 * circuits into a simulated response and updates the local demo
 * wallet/transactions instead -- see src/lib/demoStore.ts.
 */

export type HadjibsService = "airtime" | "data";

export interface HadjibsPurchasePayload {
  service: HadjibsService;
  serviceId: string; // network id, e.g. "mtn" | "glo" | "airtel" | "9mobile"
  variationCode?: string; // Hadjibs numeric Plan Id (data only) -- see hadjibsDataPlans.ts
  amount?: number;
  phone: string;
}

export interface HadjibsPurchaseResult {
  success: boolean;
  reference: string;
  message: string;
  raw?: unknown;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function purchase(payload: HadjibsPurchasePayload): Promise<HadjibsPurchaseResult> {
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
        type: payload.service as TransactionType,
        amount,
        status: "successful",
        reference,
        title: `${payload.service} purchase`,
      },
      -amount
    );
    return { success: true, reference, message: "Purchase successful" };
  }

  const { data, error } = await supabase.functions.invoke("hadjibs-purchase", {
    body: { action: "pay", ...payload },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as HadjibsPurchaseResult;
}

/**
 * Local stand-in for VTpass's live GET /service-variations -- Hadjibs has
 * no equivalent endpoint, so this just filters the static catalog in
 * hadjibsDataPlans.ts. Same {code, name, price} shape as VtpassVariation so
 * Data.tsx's category-grouping code (src/lib/dataPlanCategories.ts) needs
 * no changes to work with either provider.
 */
export interface HadjibsVariation {
  code: string;
  name: string;
  price: number;
}

export function getDataPlans(network: string): HadjibsVariation[] {
  return HADJIBS_DATA_PLANS.filter((p) => p.network === network).map((p) => ({
    code: p.id,
    name: p.name,
    price: p.price,
  }));
}
