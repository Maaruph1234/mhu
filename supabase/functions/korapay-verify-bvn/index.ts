// Supabase Edge Function: korapay-verify-bvn
// Deploy with: supabase functions deploy korapay-verify-bvn --no-verify-jwt
//
// IMPORTANT: deploy with --no-verify-jwt -- can run before a user has a
// Supabase session, same reasoning as korapay-verify-nin.
//
// Secrets required: KORAPAY_SECRET_KEY (sk_test_xxx / sk_live_xxx),
// KORAPAY_BASE_URL (https://api.korapay.com for both test and live).
//
// Endpoint/request/response shape confirmed directly against
// developers.korapay.com/docs/nigeria-bvn -- not guessed (the previous
// version of this file used a made-up endpoint, /merchant/api/v1/bvn/verify,
// and a made-up request/response shape that doesn't match Kora's real API
// at all):
//   POST {KORAPAY_BASE_URL}/merchant/api/v1/identities/ng/bvn
//   headers: Authorization: Bearer <secret key>, Content-Type: application/json
//   body: { id: <BVN>, verification_consent: true,
//           validation: { first_name, last_name } }
//   -> { status: true, message, data: { id, first_name, last_name,
//        middle_name, date_of_birth, phone_number, nin, ...,
//        validation: { first_name: {value, match}, last_name: {value, match} } } }
//
// Not currently called from any live UI flow -- Register.tsx verifies
// identity via NIN (see korapay-verify-nin), and FundWallet.tsx collects a
// fresh BVN straight into korapay-create-account without a separate lookup
// first. Kept correct and real (rather than left broken) for API
// completeness / in case a BVN-based flow is added later.
//
// date_of_birth isn't in Kora's validation object here since the caller
// (VerifyBvnInput) doesn't currently collect a birthday alongside BVN --
// matching is done on first_name/last_name only, which Kora's docs mark as
// independently optional per-field, not an all-or-nothing group.

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

const KORAPAY_BASE_URL = Deno.env.get("KORAPAY_BASE_URL") ?? "https://api.korapay.com";
const KORAPAY_SECRET_KEY = Deno.env.get("KORAPAY_SECRET_KEY") ?? "";

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.replace(/^234/, "").replace(/^0/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { bvn, firstName, lastName, phone } = await req.json();
    if (!bvn || !firstName || !lastName) {
      return json({ error: "bvn, firstName, and lastName are required" }, { status: 400 });
    }
    if (!KORAPAY_SECRET_KEY) {
      return json({ error: "Korapay is not configured (missing KORAPAY_SECRET_KEY)" }, { status: 500 });
    }

    const res = await fetch(`${KORAPAY_BASE_URL}/merchant/api/v1/identities/ng/bvn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KORAPAY_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: bvn,
        verification_consent: true,
        validation: {
          first_name: firstName,
          last_name: lastName,
        },
      }),
    });

    const payload = await res.json();
    if (!res.ok || !payload?.status) {
      return json({ verified: false, reason: payload?.message ?? "BVN could not be verified" }, { status: res.ok ? 200 : 502 });
    }

    const record = payload.data ?? {};
    const validation = record.validation ?? {};
    const firstNameMatch = Boolean(validation.first_name?.match);
    const lastNameMatch = Boolean(validation.last_name?.match);

    if (!firstNameMatch || !lastNameMatch) {
      return json({
        verified: false,
        reason: "Those details don't match your BVN record. Please check your name and try again.",
      });
    }

    let phoneWarning: string | null = null;
    const recordPhone = record.phone_number as string | undefined;
    if (recordPhone && phone && normalizePhone(recordPhone) !== normalizePhone(phone)) {
      phoneWarning = "The phone number on your BVN record differs from the one you entered — you can still continue.";
    }

    return json({ verified: true, phoneWarning });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
