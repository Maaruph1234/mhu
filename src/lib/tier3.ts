import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import type { Tier3DocumentType, Tier3Verification } from "../types";

/**
 * Tier 3 (enhanced KYC) document submission -- see supabase/schema.sql's
 * "KYC tier system" block for the full design. There's no automated
 * document-verification provider anymore (that was Payvessel's job, removed
 * Sept 2026), so this is manual-review-only: upload a document, an admin
 * approves or rejects it by hand in the Supabase table editor, and a
 * database trigger bumps kyc_tier to 3 the moment a row is approved.
 */

export async function getMyTier3Submissions(): Promise<Tier3Verification[]> {
  if (isDemoMode) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("tier3_verifications")
    .select("*")
    .eq("user_id", user.id)
    .order("submitted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Tier3Verification[];
}

/**
 * Uploads the file directly to the private `tier3-documents` Storage
 * bucket (under the user's own id, so Storage's own RLS policy allows the
 * write), then records the submission via the tier3-submit-verification
 * edge function. Two steps because Storage uploads go straight from the
 * browser with the user's own session -- there's no reason to proxy a
 * multi-MB file through an edge function just to re-upload it server-side.
 */
export async function submitTier3Verification(
  documentType: Tier3DocumentType,
  file: File
): Promise<Tier3Verification> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 900));
    return {
      id: `demo-${Date.now()}`,
      user_id: "demo-user",
      document_type: documentType,
      document_url: "demo",
      status: "pending",
      reviewer_notes: null,
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const documentPath = `${user.id}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from("tier3-documents").upload(documentPath, file, {
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase.functions.invoke("tier3-submit-verification", {
    body: { documentType, documentPath },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as Tier3Verification;
}

export const TIER3_DOCUMENT_LABELS: Record<Tier3DocumentType, string> = {
  utility_bill: "Utility bill",
  drivers_license: "Driver's license",
  voters_card: "Voter's card",
  passport: "International passport",
  nin_slip: "NIN slip",
};
