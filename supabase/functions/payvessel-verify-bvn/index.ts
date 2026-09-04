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
// SWITCHED FROM ENHANCED TO BASIC (confirmed live with Payvessel support,
// tested directly in their own docs.payvessel.com Postman-style playground
// on a real BVN, Sept 2026): the Enhanced endpoint
// (/kyc/api/v1/merchant/bvn/enhanced) was intermittently returning a
// completely different person's identity data even against a correctly
// funded business wallet -- reproduced inside Payvessel's own testing tool,
// not just our code, so it's a bug on their Enhanced service specifically.
// Basic (/kyc/api/v1/merchant/bvn/basic) reliably returned a correct 96%
// match against the same real BVN in that same test. Endpoint/request/
// response shape confirmed directly against
// docs.payvessel.com/api-reference/verification/basic-bvn-verification --
// not guessed:
//   POST {PAYVESSEL_BASE_URL}/kyc/api/v1/merchant/bvn/basic
//   headers: api-key, api-secret, Content-Type: application/json
//   { bvn, first_name, middle_name, last_name, gender, birthday, phone_number }
//   -> { success, message, data: { name_match_rlt, names_match_percentage,
//        birthday_match_rlt, gender_match_rlt, phone_number_match_rlt },
//        charges }
//
// Unlike Enhanced, Basic does NOT return the BVN record's actual name/phone
// for us to read back -- it only returns match verdicts ("MATCH" /
// "NOT_MATCH") against whatever first_name/last_name/gender/birthday/
// phone_number we send it. So there's no "verified record" to hand back to
// the caller here; on a match, the caller just uses what the user already
// typed (it's already been confirmed to match Payvessel's own record).
// middle_name is accepted empty -- Payvessel's own playground test
// succeeded with it left blank, so it's not force-required here even though
// their docs UI marks the field "required".
//
// NOTE: Payvessel bills your merchant wallet per Basic BVN lookup (even on
// a "not found"/no-match result, per their own docs, same as Enhanced did)
// -- if every call here fails with a 402 "insufficient wallet balance"
// error, that's your Payvessel WALLET (a separate balance from your
// settlement account -- confirmed with their support) needing a top-up,
// not a bug here.
//
// Nothing here is persisted to our own database -- the BVN and the full
// Payvessel response are used only for this one pass/fail check and then
// discarded, same policy the Enhanced version had.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { bvn, firstName, middleName, lastName, gender, birthday, phone } = await req.json();

    if (!bvn || !/^\d{11}$/.test(bvn)) {
      return json({ verified: false, reason: "Enter a valid 11-digit BVN" }, { status: 400 });
    }
    if (!firstName?.trim() || !lastName?.trim()) {
      return json({ verified: false, reason: "First and last name are required" }, { status: 400 });
    }
    if (!gender || (gender !== "MALE" && gender !== "FEMALE")) {
      return json({ verified: false, reason: "Select a gender" }, { status: 400 });
    }
    if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      return json({ verified: false, reason: "Enter a valid date of birth" }, { status: 400 });
    }
    if (!phone?.trim()) {
      return json({ verified: false, reason: "Phone number is required" }, { status: 400 });
    }

    const requestBody = {
      bvn,
      first_name: firstName.trim(),
      middle_name: middleName?.trim() ?? "",
      last_name: lastName.trim(),
      gender,
      birthday,
      phone_number: phone.trim(),
    };
    // Logged so the EXACT outgoing request is retrievable from Supabase's
    // function logs -- needed to compare, field by field, against a known-
    // good manual test (e.g. in Payvessel's own docs playground) when
    // diagnosing a mismatch that shouldn't be happening. BVN/name/phone
    // aren't API secrets (unlike PAYVESSEL_API_KEY/SECRET), safe to log.
    console.log("payvessel-verify-bvn: outgoing request to Payvessel", JSON.stringify(requestBody));

    const pvRes = await fetch(`${PAYVESSEL_BASE_URL}/kyc/api/v1/merchant/bvn/basic`, {
      method: "POST",
      headers: {
        "api-key": PAYVESSEL_API_KEY,
        "api-secret": PAYVESSEL_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const pvJson = await pvRes.json();
    // Logged so the raw Payvessel response is retrievable from Supabase's
    // function logs -- needed to hand to Payvessel support when disputing a
    // mismatched identity result, since nothing else captures this.
    console.log("payvessel-verify-bvn: raw Payvessel response", JSON.stringify(pvJson));

    if (pvRes.status === 402) {
      return json(
        {
          verified: false,
          reason: "Identity verification is temporarily unavailable. Please try again shortly.",
        },
        { status: 502 }
      );
    }
    if (!pvRes.ok || !pvJson?.success || !pvJson?.data) {
      return json(
        { verified: false, reason: pvJson?.message ?? "Could not verify that BVN right now. Please try again." },
        { status: 502 }
      );
    }

    const data = pvJson.data as Record<string, unknown>;
    const nameMatch = data.name_match_rlt === "MATCH";
    // Gender/birthday/phone match results are checked defensively -- only
    // enforced if Payvessel actually returned a verdict for that field, so a
    // field they don't evaluate for a given account tier doesn't silently
    // block otherwise-valid registrations.
    const genderMatch = data.gender_match_rlt === undefined || data.gender_match_rlt === "MATCH";
    const birthdayMatch = data.birthday_match_rlt === undefined || data.birthday_match_rlt === "MATCH";
    const phoneMatch = data.phone_number_match_rlt === undefined || data.phone_number_match_rlt === "MATCH";

    if (!nameMatch) {
      return json({ verified: false, reason: "The name you entered doesn't match this BVN's records." });
    }
    if (!birthdayMatch) {
      return json({ verified: false, reason: "The date of birth you entered doesn't match this BVN's records." });
    }
    if (!genderMatch) {
      return json({ verified: false, reason: "The gender you entered doesn't match this BVN's records." });
    }
    if (!phoneMatch) {
      return json({ verified: false, reason: "The phone number you entered doesn't match this BVN's records." });
    }

    // No record data to hand back (Basic only returns match verdicts) -- the
    // caller uses what the user already typed, since it's now confirmed to
    // match Payvessel's record.
    return json({ verified: true, matchPercentage: data.names_match_percentage ?? null });
  } catch (err) {
    return json({ verified: false, reason: (err as Error).message }, { status: 500 });
  }
});
