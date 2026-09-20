// Supabase Edge Function: korapay-verify-nin
// Deploy with: supabase functions deploy korapay-verify-nin --no-verify-jwt
//
// IMPORTANT: deploy with --no-verify-jwt -- runs BEFORE a user has a
// Supabase session (called from Register.tsx before supabase.auth.signUp()).
//
// Secrets required: KORAPAY_SECRET_KEY (sk_test_xxx / sk_live_xxx),
// KORAPAY_BASE_URL (https://api.korapay.com for both test and live).
//
// Endpoint/request/response shape confirmed directly against
// developers.korapay.com/docs/nigeria-nin -- not guessed:
//   POST {KORAPAY_BASE_URL}/merchant/api/v1/identities/ng/nin
//   headers: Authorization: Bearer <secret key>, Content-Type: application/json
//   body: { id: <NIN>, verification_consent: true,
//           validation: { first_name, last_name, date_of_birth } }
//   -> { status: true, message, data: { id, first_name, last_name,
//        middle_name, date_of_birth, phone_number, address, gender, ...,
//        validation: { first_name: {value, match}, last_name: {value, match},
//                       date_of_birth: {value, match} } } }
//
// Unlike Payvessel's Basic NIN Verification (which only ever returned
// true/false match verdicts, never the record's own data), Kora's NIN
// Lookup always returns the full government record in `data` regardless of
// whether the validation fields matched -- so `verified` here is derived
// from data.validation.*.match rather than a single top-level flag, and a
// mismatch on any of first_name/last_name/date_of_birth fails the check.
//
// Kora's NIN validation has no phone field to match against (unlike BVN's
// record, which does carry one) -- data.phone_number is still compared
// against what the caller typed, as a soft warning rather than a hard
// block, matching the same phoneWarning pattern payvessel-verify-nin used.
//
// verification_consent: true is required by Kora's API for every lookup --
// it's not something we collect from the user via a checkbox; registering
// through this flow at all is treated as that consent, same as Payvessel's
// equivalent required no separate UI for it either.

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

// Loose phone comparison -- strips leading 0/+234 and non-digits so
// "08012345678" and "+2348012345678" are treated as the same number,
// same normalization payvessel-verify-nin used.
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.replace(/^234/, "").replace(/^0/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { nin, firstName, lastName, birthday, phone } = await req.json();
    if (!nin || !firstName || !lastName || !birthday) {
      return json({ error: "nin, firstName, lastName, and birthday are required" }, { status: 400 });
    }
    if (!KORAPAY_SECRET_KEY) {
      return json({ error: "Korapay is not configured (missing KORAPAY_SECRET_KEY)" }, { status: 500 });
    }

    const res = await fetch(`${KORAPAY_BASE_URL}/merchant/api/v1/identities/ng/nin`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KORAPAY_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: nin,
        verification_consent: true,
        validation: {
          first_name: firstName,
          last_name: lastName,
          date_of_birth: birthday,
        },
      }),
    });

    const payload = await res.json();
    if (!res.ok || !payload?.status) {
      return json({ verified: false, reason: payload?.message ?? "NIN could not be verified" }, { status: res.ok ? 200 : 502 });
    }

    const record = payload.data ?? {};
    const validation = record.validation ?? {};
    const firstNameMatch = Boolean(validation.first_name?.match);
    const lastNameMatch = Boolean(validation.last_name?.match);
    const dobMatch = Boolean(validation.date_of_birth?.match);

    if (!firstNameMatch || !lastNameMatch || !dobMatch) {
      return json({
        verified: false,
        reason: "Those details don't match your NIN record. Please check your name and date of birth and try again.",
      });
    }

    let phoneWarning: string | null = null;
    const recordPhone = record.phone_number as string | undefined;
    if (recordPhone && phone && normalizePhone(recordPhone) !== normalizePhone(phone)) {
      phoneWarning = "The phone number on your NIN record differs from the one you entered — you can still continue.";
    }

    return json({ verified: true, phoneWarning });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
