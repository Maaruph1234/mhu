// Supabase Edge Function: xpresswallet-create-wallet
// Deploy with: supabase functions deploy xpresswallet-create-wallet
// Secrets required (set with `supabase secrets set ...`):
//   XPRESSWALLET_BASE_URL, XPRESSWALLET_SECRET_KEY
//
// Creates a Customer + Wallet on Xpress Wallet (Providus Bank) for the
// authenticated user via POST /wallet, then stores the returned dedicated
// virtual account (account number, bank name, etc.) in the
// `xpresswallet_accounts` table so FundWallet.tsx can display it.
//
// Xpress Wallet requires BVN, full name, date of birth, phone, email, and
// address to create a wallet — see the "Create Customer Wallet" request in
// the Xpress Wallet Postman collection for the authoritative field list and
// response shape. This is a working template based on that collection, not
// a confirmed-final integration — re-check field names/response shape
// against Xpress Wallet's live docs before going to production.

import { createClient } from "npm:@supabase/supabase-js@2";

const XPRESSWALLET_BASE_URL = Deno.env.get("XPRESSWALLET_BASE_URL") ?? "";
const XPRESSWALLET_SECRET_KEY = Deno.env.get("XPRESSWALLET_SECRET_KEY") ?? "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
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
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const { bvn, dateOfBirth, address } = await req.json();
    if (!bvn || !dateOfBirth || !address) {
      return new Response(
        JSON.stringify({ error: "bvn, dateOfBirth, and address are required" }),
        { status: 400 }
      );
    }

    // Already has an account? Return it instead of creating a duplicate.
    const { data: existing } = await service
      .from("xpresswallet_accounts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify(existing), { headers: { "Content-Type": "application/json" } });
    }

    const { data: profile } = await service
      .from("users")
      .select("display_name, email, phone_number")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404 });
    }

    const [firstName, ...rest] = (profile.display_name || "MHU User").trim().split(" ");
    const lastName = rest.join(" ") || firstName;

    const xwRes = await fetch(`${XPRESSWALLET_BASE_URL}/wallet`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${XPRESSWALLET_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
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
      return new Response(
        JSON.stringify({ error: xwJson?.message ?? "Xpress Wallet could not create your account" }),
        { status: 502 }
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
      return new Response(JSON.stringify({ error: insertError.message }), { status: 500 });
    }

    // Note: bvn/dateOfBirth/address are intentionally NOT persisted anywhere
    // in our own database — the real `users` table has no columns for them,
    // and there's no need to store them ourselves once Xpress Wallet has
    // created the account; they're passed through above and kept only on
    // Xpress Wallet's side.

    return new Response(JSON.stringify(inserted), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
