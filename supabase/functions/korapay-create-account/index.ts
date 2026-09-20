// Supabase Edge Function: korapay-create-account
// Deploy with: supabase functions deploy korapay-create-account
//
// Called from FundWallet.tsx once a user submits their BVN (collected fresh
// on that screen -- Kora's virtual account KYC requires a real BVN
// regardless of what NIN was verified at signup).
//
// Secrets required: KORAPAY_SECRET_KEY, KORAPAY_BASE_URL,
// KORAPAY_BANK_CODE (which bank issues the virtual account -- "000" for
// sandbox/test keys per developers.korapay.com/docs/virtual-bank-accounts-ngn,
// or a real bank code for live: 035 Wema, 070 Fidelity, 103 Globus, 033 UBA,
// 090405 Moniepoint, 107 Optimus, 104 Parallex, 214 FCMB. Falls back to 070
// if unset, matching the "Wema/Fidelity"-backed account this project's
// README always described).
//
// Endpoint/request/response shape confirmed directly against
// developers.korapay.com/docs/virtual-bank-accounts-ngn -- not guessed (the
// previous version of this file sent a flat {bvn,nin,email,phone,name} body
// with none of Kora's actually-required fields, which would fail Kora's own
// validation every time):
//   POST {KORAPAY_BASE_URL}/merchant/api/v1/virtual-bank-account
//   body: { account_name, account_reference, permanent: true, bank_code,
//           customer: { name, email }, kyc: { bvn (required), nin (optional) } }
//   -> { status: true, message, data: { account_name, account_number,
//        bank_code, bank_name, account_reference, account_status, ... } }

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
const KORAPAY_BANK_CODE = Deno.env.get("KORAPAY_BANK_CODE") ?? "070";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!KORAPAY_SECRET_KEY) {
      return json({ error: "Korapay is not configured (missing KORAPAY_SECRET_KEY)" }, { status: 500 });
    }

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

    // Idempotent -- a user who already has an account just gets it back,
    // same as payvessel-create-account's behavior.
    const { data: existing } = await service
      .from("korapay_accounts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      return json(existing);
    }

    const { bvn, nin: ninInput } = await req.json();
    if (!bvn || String(bvn).trim().length !== 11) {
      return json({ error: "A valid 11-digit bvn is required" }, { status: 400 });
    }

    const { data: profile } = await service
      .from("users")
      .select("display_name, email, verified_nin")
      .eq("id", user.id)
      .single();
    if (!profile) {
      return json({ error: "Profile not found" }, { status: 404 });
    }

    const nin = (ninInput ?? profile.verified_nin ?? "").toString().trim();
    const accountReference = crypto.randomUUID();

    const res = await fetch(`${KORAPAY_BASE_URL}/merchant/api/v1/virtual-bank-account`, {
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
        kyc: {
          bvn: String(bvn).trim(),
          ...(nin ? { nin } : {}),
        },
      }),
    });

    const payload = await res.json();
    if (!res.ok || !payload?.status) {
      return json({ error: payload?.message ?? "Korapay could not create your account" }, { status: 502 });
    }

    const data = payload.data ?? {};
    const account = {
      user_id: user.id,
      account_number: data.account_number ?? "",
      account_name: data.account_name ?? profile.display_name ?? "MHU User",
      bank_name: data.bank_name ?? "",
      bank_code: data.bank_code ?? KORAPAY_BANK_CODE,
      account_reference: data.account_reference ?? accountReference,
      status: data.account_status ?? "active",
    };

    const { data: inserted, error: insertError } = await service
      .from("korapay_accounts")
      .insert(account)
      .select()
      .single();
    if (insertError) {
      return json({ error: insertError.message }, { status: 500 });
    }

    return json(inserted);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
