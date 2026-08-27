// Supabase Edge Function: xpresswallet-webhook
// Deploy with: supabase functions deploy xpresswallet-webhook --no-verify-jwt
//
// IMPORTANT: deploy with --no-verify-jwt. Xpress Wallet calls this
// endpoint directly (there's no Supabase user session on the request), so
// Supabase's default "reject requests without a valid user JWT" behaviour
// must be turned off for this function specifically.
//
// Secrets required (set with `supabase secrets set ...`):
//   XPRESSWALLET_WEBHOOK_SECRET — a secret you invent yourself (see below)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are already set automatically
//
// Set this function's deployed URL as the callbackURL / sandboxCallbackURL
// in your Xpress Wallet merchant dashboard, with your chosen secret
// appended as a query param, e.g.:
//   https://YOUR_PROJECT.functions.supabase.co/xpresswallet-webhook?secret=YOUR_SECRET
//
// This is a working template based on the wallet/transaction shapes shown
// in the Xpress Wallet Postman collection, NOT a confirmed webhook payload
// — confirm the exact event shape and any signature header Xpress Wallet
// sends (check your dashboard's webhook logs after a test transfer) and
// adjust the field reads below before going live.

import { createClient } from "npm:@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("XPRESSWALLET_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (WEBHOOK_SECRET && url.searchParams.get("secret") !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: "Invalid webhook secret" }), { status: 401 });
    }

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = await req.json();

    // Xpress Wallet's exact event shape may differ from this — adjust once
    // you can see a real webhook payload in your dashboard's logs.
    const walletId = payload?.wallet?.id ?? payload?.walletId;
    const amount = Number(payload?.amount ?? payload?.transaction?.amount ?? 0);
    const reference = payload?.reference ?? payload?.transaction?.reference ?? `XW-${Date.now()}`;

    if (!walletId || !amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Missing walletId or amount" }), { status: 400 });
    }

    const { data: account } = await service
      .from("xpresswallet_accounts")
      .select("user_id")
      .eq("xw_wallet_id", walletId)
      .maybeSingle();

    if (!account) {
      return new Response(JSON.stringify({ error: "Unknown wallet" }), { status: 404 });
    }

    // Idempotency: skip if this reference has already been recorded, so a
    // retried/duplicate webhook delivery can't double-credit the wallet.
    const { data: dupe } = await service
      .from("transactions")
      .select("id")
      .eq("reference", reference)
      .maybeSingle();
    if (dupe) {
      return new Response(
        JSON.stringify({ status: "already processed" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // There's no separate `wallets` table in the real schema — balance is
    // just `users.wallet_balance`.
    const { data: userRow } = await service
      .from("users")
      .select("wallet_balance")
      .eq("id", account.user_id)
      .single();

    if (userRow) {
      await service
        .from("users")
        .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) + amount })
        .eq("id", account.user_id);
    }

    await service.from("transactions").insert({
      user_id: account.user_id,
      type: "fund_wallet",
      amount,
      status: "successful",
      reference,
      title: "Wallet funded via bank transfer",
    });

    return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
