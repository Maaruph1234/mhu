// Supabase Edge Function: korapay-verify-bvn
// Deploy with: supabase functions deploy korapay-verify-bvn --no-verify-jwt
//
// IMPORTANT: deploy with --no-verify-jwt. This runs BEFORE a user has a
// Supabase session -- it's the gate that decides whether registration is
// even allowed to proceed -- so there's no JWT to verify yet, same
// reasoning as korapay-webhook.
//
// Secrets required: KORAPAY_SECRET_KEY, KORAPAY_BASE_URL (same ones every
// other Korapay function already uses).
//
// Endpoint/request/response shape confirmed directly against
// developers.korapay.com/docs/nigeria-bvn -- not guessed:
//   POST /merchant/api/v1/identities/ng/bvn
//   { id, verification_consent: true, validation: { first_name, last_name } }
//   -> { status, data: { first_name, last_name, phone_number,
//        validation: { first_name: { value, match }, last_name: { value, match } }, ... } }
//
// Korapay's own `validation` object only checks first_name/last_name (and
// optionally date_of_birth) -- it does NOT check phone_number. So the phone
// match below is done here ourselves, comparing the last 10 digits of the
// BVN record's own phone_number against what the user typed at signup
// (same "ignore 0/+234/234 prefix" normalization already used for wallet
// transfers in schema.sql's normalize_ng_phone()).
//
// NOTE: this Korapay account must have the Identity product enabled
// (separate from Payments/Payouts) -- if every call here fails with an
// auth/permission error, that's an account setting on the Kora dashboard,
// not a code bug (same class of issue as VTpass's per-product whitelisting
// and the still-open Korapay Payout "Invalid authentication token" case).
//
// SANDBOX TEST VALUE (per developers.korapay.com/docs/testing-your-integration):
// only BVN 22222222222 resolves to real test data -- first_name "Trevor",
// last_name "Mandela", phone "08031234567". Use those exact values to test
// a successful verification, and any mismatched name/phone to test a
// decline. BVN 00000000000 is the documented "invalid" test case.
//
// Nothing here is persisted to our own database -- the BVN and the full
// Kora response are used only for this one pass/fail check and then
// discarded, same policy as korapay-create-account.

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

function normalizePhone(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "").slice(-10);
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

    const kpRes = await fetch(`${KORAPAY_BASE_URL}/merchant/api/v1/identities/ng/bvn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KORAPAY_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: bvn,
        verification_consent: true,
        validation: { first_name: firstName.trim(), last_name: lastName.trim() },
      }),
    });
    const kpJson = await kpRes.json();

    if (!kpRes.ok || !kpJson?.status) {
      return json(
        { verified: false, reason: kpJson?.message ?? "Could not verify that BVN right now. Please try again." },
        { status: 502 }
      );
    }

    const data = kpJson.data ?? {};
    const firstNameMatch = data.validation?.first_name?.match === true;
    const lastNameMatch = data.validation?.last_name?.match === true;
    const phoneMatch = phone ? normalizePhone(data.phone_number) === normalizePhone(phone) : true;

    if (!firstNameMatch || !lastNameMatch) {
      return json({ verified: false, reason: "The name you entered doesn't match this BVN's records." });
    }
    if (!phoneMatch) {
      return json({ verified: false, reason: "The phone number you entered doesn't match this BVN's records." });
    }

    // Return the BVN record's own name/phone (not just a match flag) so the
    // caller can populate the new account with exactly what's on file --
    // correct spelling/casing per the government record -- rather than
    // trusting whatever the person happened to type.
    return json({
      verified: true,
      firstName: data.first_name,
      lastName: data.last_name,
      phone: data.phone_number,
    });
  } catch (err) {
    return json({ verified: false, reason: (err as Error).message }, { status: 500 });
  }
});
