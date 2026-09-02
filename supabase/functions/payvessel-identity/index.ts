// Supabase Edge Function: payvessel-identity
// Deploy with: supabase functions deploy payvessel-identity
//
// Extra identity document verification -- NIN (enhanced), driver's
// license, voter's card, international passport -- via Payvessel's
// Identity Verification API. Endpoints/fields confirmed directly against
// docs.payvessel.com/api-reference/verification/* -- not guessed. Same
// /kyc path prefix as payvessel-verify-bvn (that function's header comment
// already noted this split: identity-verification endpoints live under
// /kyc/api/v1/merchant/..., everything else under
// /pms/api/external/request/...).
//
// Secrets required: PAYVESSEL_API_KEY, PAYVESSEL_SECRET, PAYVESSEL_BASE_URL
// (same three already used everywhere else), plus:
//   IDENTITY_VERIFICATION_FEE_NGN (optional, default 150)
//
// ============================================================================
// WHY THERE'S A FEE
// ============================================================================
// Every one of these calls costs OUR Payvessel business wallet ~NGN 25,
// and -- per Payvessel's own docs -- that charge applies EVEN WHEN the
// document isn't found (see the "documentNotFound" example in each
// endpoint's docs: `charges.charged: true`). Without a fee here, anyone
// could drain the business wallet by submitting garbage document numbers
// all day. So a flat NGN fee is deducted from the USER'S wallet up front,
// covering Payvessel's cost plus a small margin, and it's charged whenever
// Payvessel actually processes the request (success OR "not found") --
// only a genuine network/5xx failure before Payvessel responds, or a 402
// (OUR wallet is out of funds) skips the charge, since in those cases
// nothing was billed to us either.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...(init.headers ?? {}) },
  });
}

const PAYVESSEL_BASE_URL = Deno.env.get("PAYVESSEL_BASE_URL") ?? "https://sandbox.payvessel.com";
const PAYVESSEL_API_KEY = Deno.env.get("PAYVESSEL_API_KEY") ?? "";
const PAYVESSEL_SECRET = Deno.env.get("PAYVESSEL_SECRET") ?? "";
const FEE_NGN = Number(Deno.env.get("IDENTITY_VERIFICATION_FEE_NGN")) || 150;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const pvHeaders = {
  "api-key": PAYVESSEL_API_KEY,
  "api-secret": PAYVESSEL_SECRET,
  "Content-Type": "application/json",
};

async function pvPost(path: string, body: unknown) {
  const res = await fetch(`${PAYVESSEL_BASE_URL}/kyc${path}`, {
    method: "POST",
    headers: pvHeaders,
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = await res.json();
  } catch {
    // non-JSON response -- treated as a hard failure below
  }
  return { status: res.status, json: parsed };
}

type DocType = "nin" | "drivers_license" | "voters_card" | "passport";

const ENDPOINTS: Record<DocType, string> = {
  nin: "/api/v1/merchant/nin/enhanced",
  drivers_license: "/api/v1/merchant/documents/drivers-license",
  voters_card: "/api/v1/merchant/documents/voters-card",
  passport: "/api/v1/merchant/documents/international-passport",
};

function buildRequestBody(docType: DocType, docNumber: string): Record<string, string> {
  switch (docType) {
    case "nin":
      return { nin: docNumber };
    case "drivers_license":
      return { license_number: docNumber };
    case "voters_card":
      return { voters_id: docNumber };
    case "passport":
      return { passport_number: docNumber };
  }
}

// Normalizes each endpoint's differently-named fields into one shape.
function extractName(docType: DocType, data: Record<string, unknown>): string {
  const first = (data.first_name as string) ?? "";
  const middle = (data.middle_name as string) ?? "";
  const last = (data.surname as string) ?? (data.last_name as string) ?? "";
  return [first, middle, last].filter(Boolean).join(" ");
}

function extractDetails(docType: DocType, data: Record<string, unknown>): Record<string, unknown> {
  const base = {
    gender: data.gender ?? null,
    birth_date: data.birth_date ?? null,
  };
  if (docType === "drivers_license") {
    return { ...base, issue_date: data.issue_date ?? null, expiry_date: data.expiry_date ?? null };
  }
  if (docType === "passport") {
    return {
      ...base,
      issue_date: data.issue_date ?? null,
      expiry_date: data.expiry_date ?? null,
      nationality: data.nationality ?? null,
    };
  }
  if (docType === "voters_card") {
    return { ...base, polling_unit: data.polling_unit ?? null, state: data.state ?? null, lga: data.lga ?? null };
  }
  return { ...base, telephone_no: data.telephone_no ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anonClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
    } = await anonClient.auth.getUser();

    if (!user) {
      return json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();

    if (body.action === "list") {
      const { data, error } = await service
        .from("identity_verifications")
        .select("*")
        .eq("user_id", user.id);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ verifications: data ?? [] });
    }

    const docType = body.docType as DocType;
    const docNumber = (body.docNumber as string ?? "").trim();

    if (!ENDPOINTS[docType]) {
      return json({ error: "Unknown document type" }, { status: 400 });
    }
    if (!docNumber) {
      return json({ error: "Document number is required" }, { status: 400 });
    }

    const { data: userRow } = await service
      .from("users")
      .select("wallet_balance")
      .eq("id", user.id)
      .single();

    if (!userRow || Number(userRow.wallet_balance ?? 0) < FEE_NGN) {
      return json({ error: `Insufficient wallet balance. This check costs ₦${FEE_NGN}.` }, { status: 402 });
    }

    const { status, json: pvJson } = await pvPost(ENDPOINTS[docType], buildRequestBody(docType, docNumber));
    // Logged so the raw Payvessel response is retrievable from Supabase's
    // function logs -- needed to hand to Payvessel support when disputing a
    // mismatched identity result, since nothing else captures this.
    console.log("payvessel-identity: raw Payvessel response", JSON.stringify({ status, docType, pvJson }));

    if (status === 402) {
      // OUR business wallet is out of funds -- Payvessel never processed
      // this, so don't charge the user.
      return json({ error: "Verification is temporarily unavailable. Please try again shortly." }, { status: 502 });
    }
    if (status !== 200 || pvJson.success === undefined) {
      // Genuine network/5xx failure -- nothing was billed to us, so nothing
      // is billed to the user either.
      return json({ error: (pvJson.message as string) ?? "Verification service is unavailable" }, { status: 502 });
    }

    // Payvessel processed the request (success or a clean "not found") --
    // it billed our wallet either way, so charge the user's fee now.
    await service
      .from("users")
      .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - FEE_NGN })
      .eq("id", user.id);

    const docLabel: Record<DocType, string> = {
      nin: "NIN",
      drivers_license: "Driver's license",
      voters_card: "Voter's card",
      passport: "International passport",
    };

    await service.from("transactions").insert({
      user_id: user.id,
      type: "identity_verification",
      amount: FEE_NGN,
      status: "successful",
      reference: `IDV-${Date.now()}`,
      title: `${docLabel[docType]} verification`,
      subtitle: pvJson.success ? "Verified" : "Document not found",
    });

    if (!pvJson.success || !pvJson.data) {
      return json({ verified: false, message: pvJson.message ?? "Document not found" });
    }

    const data = pvJson.data as Record<string, unknown>;
    const row = {
      user_id: user.id,
      doc_type: docType,
      doc_number: docNumber,
      verified_name: extractName(docType, data),
      status: "verified",
      details: extractDetails(docType, data),
    };

    const { data: saved, error: saveError } = await service
      .from("identity_verifications")
      .upsert(row, { onConflict: "user_id,doc_type" })
      .select()
      .single();

    if (saveError) {
      return json({ error: saveError.message }, { status: 500 });
    }

    return json({ verified: true, verification: saved });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
