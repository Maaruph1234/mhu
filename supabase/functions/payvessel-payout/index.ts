// Supabase Edge Function: payvessel-payout
// Deploy with: supabase functions deploy payvessel-payout
// Secrets required: PAYVESSEL_API_KEY, PAYVESSEL_SECRET, PAYVESSEL_BASE_URL
//
// Replaces korapay-payout. Handles "Transfer to bank" -- sending money OUT
// of a user's MHU wallet to an external Nigerian bank account, via
// Payvessel's Transfers API. Endpoints/fields confirmed directly against
// docs.payvessel.com/api-reference/transfers/* -- not guessed:
//   - GET  /pms/api/external/request/wallet/banks/            -> bank list
//   - POST /pms/api/external/request/wallet/validate-account/
//     { account_number, bank_code } -> { data: { account_name, ... } }
//   - POST /pms/api/external/request/wallet/transfer/
//     { amount, account_number, bank_code, account_name, narration, reference }
//     -> { data: { status: "pending"|"success"|"failed", session_id, ... } }
//
// A transfer response of "pending" does NOT mean the money has definitely
// moved -- the final outcome arrives later via the "transfer.success" /
// "transfer.failed" / "transfer.reversed" webhook events, which
// payvessel-webhook/index.ts handles: it flips the transaction to
// "successful", or to "failed" AND refunds the wallet. That's why the
// wallet is debited up front here (optimistically) but a "pending"
// transaction row is left in place for the webhook to resolve either way.
//
// CORS: called directly from the browser, same reasoning as
// payvessel-create-account/index.ts and vtpass-purchase/index.ts.

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const pvHeaders = {
  "api-key": PAYVESSEL_API_KEY,
  "api-secret": PAYVESSEL_SECRET,
  "Content-Type": "application/json",
};

async function pvGet(path: string) {
  const res = await fetch(`${PAYVESSEL_BASE_URL}${path}`, { headers: pvHeaders });
  return { ok: res.ok, json: await res.json() };
}

async function pvPost(path: string, body: unknown) {
  const res = await fetch(`${PAYVESSEL_BASE_URL}${path}`, {
    method: "POST",
    headers: pvHeaders,
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
      const { ok, json: banksJson } = await pvGet("/pms/api/external/request/wallet/banks/");
      if (!ok || !banksJson?.status) {
        return json({ error: banksJson?.message ?? "Could not load bank list" }, { status: 502 });
      }
      return json({
        banks: (banksJson.data ?? [])
          .filter((b: { is_active?: boolean }) => b.is_active !== false)
          .map((b: { bank_name: string; bank_code: string }) => ({
            name: b.bank_name,
            code: b.bank_code,
          })),
      });
    }

    // --- resolve an account number to a name before paying (no debit) ---
    if (body.action === "resolve") {
      const { bankCode, accountNumber } = body;
      if (!bankCode || !accountNumber) {
        return json({ error: "bankCode and accountNumber are required" }, { status: 400 });
      }
      const { ok, json: resolveJson } = await pvPost("/pms/api/external/request/wallet/validate-account/", {
        account_number: accountNumber,
        bank_code: bankCode,
      });
      if (!ok || !resolveJson?.status) {
        return json({ error: resolveJson?.message ?? "Could not resolve that account" }, { status: 502 });
      }
      return json({ accountName: resolveJson.data.account_name });
    }

    // --- payout (debit wallet, then call Payvessel) ---
    const { bankCode, accountNumber, accountName, narration } = body;
    const amount = Number(body.amount ?? 0);

    if (!bankCode || !accountNumber || !amount || amount <= 0) {
      return json({ error: "bankCode, accountNumber, and a valid amount are required" }, { status: 400 });
    }

    const { data: userRow } = await service
      .from("users")
      .select("wallet_balance, display_name")
      .eq("id", user.id)
      .single();

    if (!userRow || Number(userRow.wallet_balance ?? 0) < amount) {
      return json({ error: "Insufficient wallet balance" }, { status: 402 });
    }

    const reference = generateReference();

    const { ok, json: transferJson } = await pvPost("/pms/api/external/request/wallet/transfer/", {
      amount: amount.toFixed(2),
      account_number: accountNumber,
      bank_code: bankCode,
      account_name: accountName || userRow.display_name || "MHU User",
      narration: narration || "MHU Global bank transfer",
      reference,
    });

    if (!ok || !transferJson?.status) {
      return json({ error: transferJson?.message ?? "Bank transfer could not be initiated" }, { status: 502 });
    }

    // Debit now, optimistically -- the webhook (transfer.success/failed/
    // reversed) resolves the final outcome and refunds automatically on
    // failure.
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
      message: transferJson.message ?? transferJson.data?.status ?? "Bank transfer initiated",
      txnLogError: txnError?.message,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
