// Supabase Edge Function: payvessel-verify-bvn
// Deploy with: supabase functions deploy payvessel-verify-bvn --no-verify-jwt
//
// Replaces korapay-verify-bvn (Payvessel is replacing Korapay as the
// identity/payments provider across both the web app and the Flutter app --
// same shared Supabase project, so this one deployment serves both).
//
// IMPORTANT: deploy with --no-verify-jwt -- runs BEFORE a user has a
// Supabase session, same reasoning as the Korapay version it replaces.
//
// Secrets required:
//   PAYVESSEL_API_KEY, PAYVESSEL_SECRET, PAYVESSEL_BASE_URL
//   (https://sandbox.payvessel.com for testing, https://api.payvessel.com live)
//
// Endpoint/request/response shape confirmed directly against
// docs.payvessel.com/api-reference/verification/enhanced-bvn-verification --
// not guessed:
//   POST {PAYVESSEL_BASE_URL}/kyc/api/v1/merchant/bvn/enhanced
//   headers: api-key, api-secret, Content-Type: application/json
//   { bvn } -> { success, message, data: { bvn, first_name, middle_name,
//                last_name, gender, name_on_card, birthday, photo,
//                phone_number, phone_number_2 }, charges }
//
// Unlike Korapay's BVN lookup, Payvessel's Enhanced BVN endpoint does NOT
// return a name/phone match verdict itself -- it just returns the BVN
// record's real data. The name/phone match check against what the user
// typed is therefore done entirely here, same normalization approach the
// Korapay version used (last-10-digits phone compare, case-insensitive
// name compare).
//
// NOTE: Payvessel bills your merchant wallet per Enhanced BVN lookup (even
// on a "not found" result, per their own docs) -- if every call here fails
// with a 402 "insufficient wallet balance" error, that's your Payvessel
// wallet needing a top-up, not a bug here.
//
// Nothing here is persisted to our own database -- the BVN and the full
// Payvessel response are used only for this one pass/fail check and then
// discarded, same policy as the Korapay version.

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

function normalizePhone(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "").slice(-10);
}

function normalizeName(n: string | null | undefined): string {
  return (n ?? "").trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { bvn, firstName, lastName, phone } = await req.json();

    if (!bvn || !/^\d{11}$/.test(bvn)) {
      return json({ verified: false, reason: "Enter a valid 11-digit BVN" }, { status: 400 });
    }
    if (!firstName?.trim() || !lastName?.trim()) {
      return json({ verified: false, reason: "First and last name are required" }, { status: 400 });
    }

    const pvRes = await fetch(`${PAYVESSEL_BASE_URL}/kyc/api/v1/merchant/bvn/enhanced`, {
      method: "POST",
      headers: {
        "api-key": PAYVESSEL_API_KEY,
        "api-secret": PAYVESSEL_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bvn }),
    });
    const pvJson = await pvRes.json();

    if (pvRes.status === 402) {
      return json(
        { verified: false, reason: "Identity verification is temporarily unavailable. Please try again shortly." },
        { status: 502 }
      );
    }
    if (!pvRes.ok || !pvJson?.success || !pvJson?.data) {
      return json(
        { verified: false, reason: pvJson?.message ?? "Could not verify that BVN right now. Please try again." },
        { status: 502 }
      );
    }

    const data = pvJson.data;
    const firstNameMatch = normalizeName(data.first_name) === normalizeName(firstName);
    const lastNameMatch = normalizeName(data.last_name) === normalizeName(lastName);
    const phoneMatch = phone
      ? normalizePhone(data.phone_number) === normalizePhone(phone) ||
        normalizePhone(data.phone_number_2) === normalizePhone(phone)
      : true;

    if (!firstNameMatch || !lastNameMatch) {
      return json({ verified: false, reason: "The name you entered doesn't match this BVN's records." });
    }
    if (!phoneMatch) {
      return json({ verified: false, reason: "The phone number you entered doesn't match this BVN's records." });
    }

    // Return the BVN record's own name/phone (not just a match flag) so the
    // caller can populate the new account with exactly what's on file.
    return json({
      verified: true,
      firstName: data.first_name,
      lastName: data.last_name,
      phone: data.phone_number,
      bvn: data.bvn,
    });
  } catch (err) {
    return json({ verified: false, reason: (err as Error).message }, { status: 500 });
  }
});
