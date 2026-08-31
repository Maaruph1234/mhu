// Supabase Edge Function: payvessel-create-account
// Deploy with: supabase functions deploy payvessel-create-account
//
// Replaces korapay-create-account. Creates a permanent (STATIC) Nigerian
// virtual bank account for the authenticated user via Payvessel's Virtual
// Account API, then stores the returned account in the `payvessel_accounts`
// table (see supabase/schema.sql) so FundWallet.tsx can display it.
//
// Secrets required:
//   PAYVESSEL_API_KEY, PAYVESSEL_SECRET, PAYVESSEL_BASE_URL,
//   PAYVESSEL_BUSINESS_ID
//   (Business ID comes from your Payvessel dashboard -- separate from the
//   API key/secret. Required in every Create Virtual Account request.)
//
// Endpoint/request/response shape confirmed directly against
// docs.payvessel.com/api-reference/virtual-accounts/create-virtual-account
// -- not guessed:
//   POST {PAYVESSEL_BASE_URL}/pms/api/external/request/customerReservedAccount/
//   headers: api-key, api-secret, Content-Type: application/json
//   { email, name, phoneNumber, bankcode: string[], account_type, businessid, bvn, nin }
//   -> { status, service, business, banks: [{ bankCode, bankName, accountNumber,
//        accountName, account_type, trackingReference, ... }] }
//
// NIN is required in addition to BVN as of Payvessel's business-approval
// notice (Aug 2026): "ensure the verified NIN/BVN is included in users'
// payloads for virtual account generation." Both are collected on the
// funding screen and passed through here untouched.
//
// account_type "STATIC" is used (not "DYNAMIC") because this is a permanent,
// reusable account for ongoing wallet funding, same intent as Korapay's
// "permanent: true" -- and BVN is mandatory for STATIC accounts per
// Payvessel's own validation error ("BVN is mandatory for STATIC accounts").
// Requesting both supported partner banks (PalmPay 999991, 9PSB 120001)
// returns one account per bank in `banks[]`; the first entry is stored and
// shown as the user's primary account, matching the single-account UX
// Korapay's integration had.
//
// CORS: this function is called directly from the browser (via
// supabase.functions.invoke), so it must answer the browser's CORS
// preflight (OPTIONS) request and send Access-Control-Allow-* headers on
// every response.

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
const PAYVESSEL_BUSINESS_ID = Deno.env.get("PAYVESSEL_BUSINESS_ID") ?? "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const { bvn, nin } = await req.json();
    if (!bvn) {
      return json({ error: "bvn is required" }, { status: 400 });
    }
    if (!nin) {
      return json({ error: "nin is required" }, { status: 400 });
    }

    // Already has an account? Return it instead of creating a duplicate.
    const { data: existing } = await service
      .from("payvessel_accounts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      return json(existing);
    }

    const { data: profile } = await service
      .from("users")
      .select("display_name, email, phone_number")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return json({ error: "Profile not found" }, { status: 404 });
    }

    const pvRes = await fetch(`${PAYVESSEL_BASE_URL}/pms/api/external/request/customerReservedAccount/`, {
      method: "POST",
      headers: {
        "api-key": PAYVESSEL_API_KEY,
        "api-secret": PAYVESSEL_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: profile.email,
        name: profile.display_name || "MHU User",
        phoneNumber: profile.phone_number || "",
        bankcode: ["999991", "120001"],
        account_type: "STATIC",
        businessid: PAYVESSEL_BUSINESS_ID,
        bvn,
        nin,
      }),
    });
    const pvJson = await pvRes.json();

    if (!pvRes.ok || !pvJson?.status || !pvJson?.banks?.length) {
      return json({ error: pvJson?.message ?? "Payvessel could not create your account" }, { status: 502 });
    }

    const primary = pvJson.banks[0];
    const account = {
      user_id: user.id,
      account_number: primary.accountNumber,
      account_name: primary.accountName,
      bank_name: primary.bankName,
      bank_code: primary.bankCode,
      tracking_reference: primary.trackingReference,
      status: "active",
    };

    const { data: inserted, error: insertError } = await service
      .from("payvessel_accounts")
      .insert(account)
      .select()
      .single();

    if (insertError) {
      return json({ error: insertError.message }, { status: 500 });
    }

    // Note: bvn/nin are intentionally NOT persisted anywhere in our own

    // database -- passed through above and kept only on Payvessel's side,
    // needed just long enough to satisfy their KYC check.

    return json(inserted);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
