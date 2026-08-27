// Supabase Edge Function: korapay-create-account
// Deploy with: supabase functions deploy korapay-create-account
// Secrets required (set with `supabase secrets set ...`):
//   KORAPAY_SECRET_KEY, KORAPAY_BASE_URL, KORAPAY_BANK_CODE
//
// Creates a permanent NGN Virtual Bank Account for the authenticated user
// via Korapay's Create Virtual Bank Account API, then stores the returned
// account (account number, bank name, etc.) in the `korapay_accounts`
// table so FundWallet.tsx can display it.
//
// Endpoint, request/response shapes, and the bank_code="000"-for-sandbox
// rule are all confirmed directly against Korapay's own docs at
// developers.korapay.com/docs/virtual-bank-accounts-ngn -- not guessed.
// Korapay's KYC requirement (mandatory since 26 Jan 2024) means a BVN must
// be supplied for every account created.
//
// CORS: this function is called directly from the browser (via
// supabase.functions.invoke), so it must answer the browser's CORS
// preflight (OPTIONS) request and send Access-Control-Allow-* headers on
// every response — without that, the browser silently blocks the request
// and the client just sees "Failed to send a request to the Edge Function".

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

const KORAPAY_BASE_URL = Deno.env.get("KORAPAY_BASE_URL") ?? "https://api.korapay.com";
const KORAPAY_SECRET_KEY = Deno.env.get("KORAPAY_SECRET_KEY") ?? "";
// "000" is Korapay's required bank_code for creating virtual accounts in
// the sandbox/test environment. Switch this to a real bank_code (e.g. "035"
// for Wema, "070" for Fidelity) once you move to live keys.
const KORAPAY_BANK_CODE = Deno.env.get("KORAPAY_BANK_CODE") ?? "000";

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

    // Already has an account? Return it instead of creating a duplicate
    // (Korapay defaults to a 50-account limit per merchant).
    const { data: existing } = await service
      .from("korapay_accounts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      return json(existing);
    }

    const { data: profile } = await service
      .from("users")
      .select("display_name, email")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return json({ error: "Profile not found" }, { status: 404 });
    }

    const accountReference = `mhu-${user.id}`;

    const kpRes = await fetch(`${KORAPAY_BASE_URL}/merchant/api/v1/virtual-bank-account`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KORAPAY_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_name: profile.display_name || "MHU User",
        account_reference: accountReference,
        permanent: true,
        bank_code: KORAPAY_BANK_CODE,
        customer: {
          name: profile.display_name || "MHU User",
          email: profile.email,
        },
        kyc: { bvn, ...(nin ? { nin } : {}) },
      }),
    });
    const kpJson = await kpRes.json();

    if (!kpRes.ok || !kpJson?.status) {
      return json({ error: kpJson?.message ?? "Korapay could not create your account" }, { status: 502 });
    }

    const account = {
      user_id: user.id,
      account_number: kpJson.data.account_number,
      account_name: kpJson.data.account_name,
      bank_name: kpJson.data.bank_name,
      bank_code: kpJson.data.bank_code,
      account_reference: kpJson.data.account_reference ?? accountReference,
      status: kpJson.data.account_status ?? "active",
    };

    const { data: inserted, error: insertError } = await service
      .from("korapay_accounts")
      .insert(account)
      .select()
      .single();

    if (insertError) {
      return json({ error: insertError.message }, { status: 500 });
    }

    // Note: bvn/nin are intentionally NOT persisted anywhere in our own
    // database -- they're passed through above and kept only on Korapay's
    // side, needed just long enough to satisfy their KYC check.

    return json(inserted);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
