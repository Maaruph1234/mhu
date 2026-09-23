// Supabase Edge Function: xpresswallet-create-wallet
// Deploy with: supabase functions deploy xpresswallet-create-wallet
//
// Secrets required (set with `supabase secrets set ...`):
//   XPRESSWALLET_BASE_URL, XPRESSWALLET_EMAIL, XPRESSWALLET_PASSWORD
//   (see _shared/xpresswallet-auth.ts for what each does)
//
// Creates a Customer + Wallet on Xpress Wallet (Providus Bank) for the
// authenticated user via POST /wallet, then stores the returned dedicated
// account (a REAL Providus Bank account number, not a pass-through virtual
// account -- see the "Create Customer Wallet" page at
// developer.providusbank.com/xpress-wallet-api/merchant/wallet/create-customer-wallet)
// in the `xpresswallet_accounts` table so FundWallet.tsx can display it.
//
// This is the ACTIVE wallet-funding integration (switched back from
// Korapay, Sept 2026 -- see .env.example and README.md).
//
// CORS: called directly from the browser (FundWallet.tsx), so it needs to
// answer the browser's preflight OPTIONS request and echo CORS headers on
// every response -- without these, supabase-js's invoke() fails before the
// function's own logic ever runs, surfaced to the user as a generic
// "Failed to send a request to the Edge Function".

import { createClient } from "npm:@supabase/supabase-js@2";
import { xwLogin, xwAuthHeaders, XW_BASE_URL } from "../_shared/xpresswallet-auth.ts";

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

    const { bvn, dateOfBirth, address } = await req.json();
    if (!bvn || bvn.length !== 11) {
      return json({ error: "A valid 11-digit BVN is required" }, { status: 400 });
    }
    if (!dateOfBirth || !address) {
      return json({ error: "dateOfBirth and address are required" }, { status: 400 });
    }

    // Already has an account? Return it instead of creating a duplicate.
    const { data: existing } = await service
      .from("xpresswallet_accounts")
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
    if (!profile.phone_number || !profile.email) {
      return json(
        { error: "Your profile needs a phone number and email on file before you can fund your wallet" },
        { status: 400 }
      );
    }

    const [firstName, ...rest] = (profile.display_name || "MHU User").trim().split(" ");
    const lastName = rest.join(" ") || firstName;

    const tokens = await xwLogin();

    const xwRes = await fetch(`${XW_BASE_URL}/wallet`, {
      method: "POST",
      headers: xwAuthHeaders(tokens),
      body: JSON.stringify({
        bvn,
        firstName,
        lastName,
        dateOfBirth,
        phoneNumber: profile.phone_number,
        email: profile.email,
        address,
      }),
    });
    const xwJson = await xwRes.json();

    if (!xwRes.ok || !xwJson?.status) {
      return json(
        { error: xwJson?.message ?? "Xpress Wallet could not create your account" },
        { status: 502 }
      );
    }

    // Xpress Wallet checks the BVN against the BVN registry and tells us
    // whether the name we sent matches what's on file for it. Surface a
    // clear error instead of silently creating an account under a
    // mismatched name.
    if (xwJson.customer?.nameMatch === false) {
      return json(
        {
          error: "The name on your profile doesn't match the name on this BVN. Update your display name to match your BVN and try again.",
        },
        { status: 422 }
      );
    }

    const account = {
      user_id: user.id,
      xw_customer_id: xwJson.customer.id,
      xw_wallet_id: xwJson.wallet.id,
      account_number: xwJson.wallet.accountNumber,
      account_name: xwJson.wallet.accountName,
      bank_name: xwJson.wallet.bankName,
      bank_code: xwJson.wallet.bankCode,
      status: xwJson.wallet.status ?? "ACTIVE",
    };

    const { data: inserted, error: insertError } = await service
      .from("xpresswallet_accounts")
      .insert(account)
      .select()
      .single();

    if (insertError) {
      return json({ error: insertError.message }, { status: 500 });
    }

    // Note: bvn/dateOfBirth/address are intentionally NOT persisted anywhere
    // in our own database — the real `users` table has no columns for them,
    // and there's no need to store them ourselves once Xpress Wallet has
    // created the account; they're passed through above and kept only on
    // Xpress Wallet's side.

    return json(inserted);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
