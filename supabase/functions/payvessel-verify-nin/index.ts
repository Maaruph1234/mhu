// Supabase Edge Function: payvessel-verify-nin
// Deploy with: supabase functions deploy payvessel-verify-nin --no-verify-jwt
//
// Registration's identity check, switched from BVN to NIN (Sept 2026) --
// mirrors payvessel-verify-bvn exactly, just against NIN instead. BVN
// verification kept failing with genuine "name doesn't match" results even
// for a real, correctly-typed BVN, so the identity gate at signup now
// checks NIN instead. (BVN is still collected separately later, at wallet
// funding time -- payvessel-create-account requires both bvn and nin per
// Payvessel's own account-creation API, that's unrelated to this identity
// check.)
//
// IMPORTANT: deploy with --no-verify-jwt -- runs BEFORE a user has a
// Supabase session, same reasoning as payvessel-verify-bvn.
//
// Secrets required:
//   PAYVESSEL_API_KEY, PAYVESSEL_SECRET, PAYVESSEL_BASE_URL
//   (https://sandbox.payvessel.com for testing, https://api.payvessel.com live)
//
// Uses Basic NIN Verification, confirmed directly against
// docs.payvessel.com/api-reference/verification/basic-nin-verification --
// not guessed. Same shape as Basic BVN Verification:
//   POST {PAYVESSEL_BASE_URL}/kyc/api/v1/merchant/nin/basic
//   headers: api-key, api-secret, Content-Type: application/json
//   { nin, first_name, middle_name, last_name, gender, birthday, phone_number }
//   -> { success, message, data: { name_match_rlt, names_match_percentage,
//        birthday_match_rlt, gender_match_rlt, phone_number_match_rlt },
//        charges }
//
// Like Basic BVN, this only returns match verdicts ("MATCH" / "NOT_MATCH"),
// not the NIN record's actual name/phone -- on a match, the caller uses
// exactly what the user already typed.
//
// NOTE: Payvessel bills your merchant wallet per Basic NIN lookup (even on
// a "not found"/no-match result, per their own docs) -- if this fails with
// a 402 "insufficient wallet balance" error, that's your Payvessel WALLET
// (separate from your settlement account) needing a top-up, not a bug here.

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
    const { nin, firstName, middleName, lastName, gender, birthday, phone } = await req.json();

    if (!nin || !/^\d{11}$/.test(nin)) {
      return json({ verified: false, reason: "Enter a valid 11-digit NIN" }, { status: 400 });
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
      nin,
      first_name: firstName.trim(),
      middle_name: middleName?.trim() ?? "",
      last_name: lastName.trim(),
      gender,
      birthday,
      phone_number: phone.trim(),
    };
    console.log("payvessel-verify-nin: outgoing request to Payvessel", JSON.stringify(requestBody));

    const pvRes = await fetch(`${PAYVESSEL_BASE_URL}/kyc/api/v1/merchant/nin/basic`, {
      method: "POST",
      headers: {
        "api-key": PAYVESSEL_API_KEY,
        "api-secret": PAYVESSEL_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const pvJson = await pvRes.json();
    console.log("payvessel-verify-nin: raw Payvessel response", JSON.stringify(pvJson));

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
        { verified: false, reason: pvJson?.message ?? "Could not verify that NIN right now. Please try again." },
        { status: 502 }
      );
    }

    const data = pvJson.data as Record<string, unknown>;
    const nameMatch = data.name_match_rlt === "MATCH";
    const genderMatch = data.gender_match_rlt === undefined || data.gender_match_rlt === "MATCH";
    const birthdayMatch = data.birthday_match_rlt === undefined || data.birthday_match_rlt === "MATCH";
    const phoneMatch = data.phone_number_match_rlt === undefined || data.phone_number_match_rlt === "MATCH";

    if (!nameMatch) {
      return json({ verified: false, reason: "The name you entered doesn't match this NIN's records." });
    }
    if (!birthdayMatch) {
      return json({ verified: false, reason: "The date of birth you entered doesn't match this NIN's records." });
    }
    if (!genderMatch) {
      return json({ verified: false, reason: "The gender you entered doesn't match this NIN's records." });
    }

    // Phone number is a soft check, not a hard block: NIMC's phone field is
    // frequently stale (people change SIM numbers over the years; the NIN
    // record isn't auto-updated), so rejecting signup on this alone locks
    // out real users even when name/DOB/gender all genuinely match. Name,
    // DOB, and gender still must match exactly -- only phone is relaxed.
    return json({
      verified: true,
      matchPercentage: data.names_match_percentage ?? null,
      phoneWarning: !phoneMatch
        ? "The phone number you entered doesn't match this NIN's records. You can still continue, but double check it's correct."
        : null,
    });
  } catch (err) {
    return json({ verified: false, reason: (err as Error).message }, { status: 500 });
  }
});
