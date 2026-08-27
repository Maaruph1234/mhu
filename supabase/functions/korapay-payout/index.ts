// Supabase Edge Function: korapay-payout
// Deploy with: supabase functions deploy korapay-payout
// Secrets required (same ones korapay-create-account already uses):
//   KORAPAY_SECRET_KEY, KORAPAY_BASE_URL
//
// Handles "Transfer to bank" -- sending money OUT of a user's MHU wallet to
// an external Nigerian bank account, via Korapay's Payout API. This is a
// different Korapay product from korapay-create-account (which is for money
// coming IN via a virtual account) -- endpoints/fields confirmed directly
// against developers.korapay.com/docs/payout-via-api, not guessed:
//   - GET  /merchant/api/v1/misc/banks?countryCode=NG        -> bank list
//   - POST /merchant/api/v1/misc/banks/resolve {bank, account, currency}
//     -> account_name (used to show "who you're sending to" before paying)
//   - POST /merchant/api/v1/transactions/disburse
//     {reference, destination:{type:"bank_account", amount, currency,
//     narration, bank_account:{bank, account}, customer:{name, email}}}
//     -> {data:{status: "processing"|"success"|"failed", ...}}
//
// A disburse call returning "processing" does NOT mean the money has
// definitely moved -- the final outcome arrives later via the
// "transfer.success" / "transfer.failed" webhook events, which
// korapay-webhook/index.ts handles: it flips the transaction to
// "successful", or to "failed" AND refunds the wallet if Korapay couldn't
// complete the transfer. That's why the wallet is debited up front here
// (optimistically) but a "pending" transaction row is left in place for
// the webhook to resolve either way.
//
// CORS: called directly from the browser, same reasoning as
// korapay-create-account/index.ts and vtpass-purchase/index.ts.

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function kget(path: string) {
  const res = await fetch(`${KORAPAY_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${KORAPAY_SECRET_KEY}` },
  });
  return { ok: res.ok, json: await res.json() };
}

async function kpost(path: string, body: unknown) {
  const res = await fetch(`${KORAPAY_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KORAPAY_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, json: await res.json() };
}

function generateReference(): string {
  return `TRFBANK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

    const body = await req.json();

    // --- list Nigerian banks (no debit) ---
    if (body.action === "banks") {
      const { ok, json: banksJson } = await kget("/merchant/api/v1/misc/banks?countryCode=NG");
      if (!ok || !banksJson?.status) {
        return json({ error: banksJson?.message ?? "Could not load bank list" }, { status: 502 });
      }
      return json({
        banks: (banksJson.data ?? []).map((b: { name: string; code: string }) => ({
          name: b.name,
          code: b.code,
        })),
      });
    }

    // --- resolve an account number to a name before paying (no debit) ---
    if (body.action === "resolve") {
      const { bankCode, accountNumber } = body;
      if (!bankCode || !accountNumber) {
        return json({ error: "bankCode and accountNumber are required" }, { status: 400 });
      }
      const { ok, json: resolveJson } = await kpost("/merchant/api/v1/misc/banks/resolve", {
        bank: bankCode,
        account: accountNumber,
        currency: "NGN",
      });
      if (!ok || !resolveJson?.status) {
        return json({ error: resolveJson?.message ?? "Could not resolve that account" }, { status: 502 });
      }
      return json({ accountName: resolveJson.data.account_name });
    }

    // --- payout (debit wallet, then call Korapay) ---
    const { bankCode, accountNumber, accountName, narration } = body;
    const amount = Number(body.amount ?? 0);

    if (!bankCode || !accountNumber || !amount || amount <= 0) {
      return json({ error: "bankCode, accountNumber, and a valid amount are required" }, { status: 400 });
    }

    const { data: userRow } = await service
      .from("users")
      .select("wallet_balance, email, display_name")
      .eq("id", user.id)
      .single();

    if (!userRow || Number(userRow.wallet_balance ?? 0) < amount) {
      return json({ error: "Insufficient wallet balance" }, { status: 402 });
    }

    const reference = generateReference();

    const { ok, json: disburseJson } = await kpost("/merchant/api/v1/transactions/disburse", {
      reference,
      destination: {
        type: "bank_account",
        amount,
        currency: "NGN",
        narration: narration || "MHU Global bank transfer",
        bank_account: { bank: bankCode, account: accountNumber },
        customer: { name: accountName || userRow.display_name || "MHU User", email: userRow.email },
      },
    });

    if (!ok || !disburseJson?.status) {
      return json({ error: disburseJson?.message ?? "Bank transfer could not be initiated" }, { status: 502 });
    }

    // Debit now, optimistically -- the webhook (transfer.success/failed)
    // resolves the final outcome and refunds automatically on failure.
    await service
      .from("users")
      .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - amount })
      .eq("id", user.id);

    // A `notify_on_transaction` trigger builds a notification body as
    // `subtitle || ' - ' || sign || amount` -- a null subtitle makes that
    // whole expression null, which violates notifications.body's NOT NULL
    // constraint and silently rolls back this entire insert. Always set one.
    const { error: txnError } = await service.from("transactions").insert({
      user_id: user.id,
      type: "bank_transfer_out",
      amount,
      status: "pending",
      reference,
      title: `Bank transfer to ${accountName || accountNumber}`,
      subtitle: `Account ${accountNumber}`,
    });
    if (txnError) {
      console.error("Failed to insert transaction record:", txnError);
    }

    return json({
      success: true,
      reference,
      message: disburseJson.data?.message ?? "Bank transfer initiated",
      txnLogError: txnError?.message,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
