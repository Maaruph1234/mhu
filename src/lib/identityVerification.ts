import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import type { IdentityDocType, IdentityVerification } from "../types";

/**
 * Client-side wrapper around the payvessel-identity Edge Function -- extra
 * ID document verification (NIN, driver's license, voter's card,
 * international passport). See that function's header comment for why a
 * flat NGN fee applies per check (Payvessel bills our business wallet even
 * when a document isn't found).
 */

async function invoke<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("payvessel-identity", { body: payload });
  if (error) {
    throw new Error(await extractFunctionErrorMessage(error));
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data as T;
}

export async function listVerifications(): Promise<IdentityVerification[]> {
  const { verifications } = await invoke<{ verifications: IdentityVerification[] }>({ action: "list" });
  return verifications;
}

export interface VerifyResult {
  verified: boolean;
  message?: string;
  verification?: IdentityVerification;
}

export async function verifyDocument(docType: IdentityDocType, docNumber: string): Promise<VerifyResult> {
  return invoke<VerifyResult>({ docType, docNumber });
}
