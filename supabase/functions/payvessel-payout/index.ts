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
// moved -- the wallet is debited up front here (optimistically) but a
// "pending" transaction row is left in place until the real outcome is
// known, resolved one of two ways:
//   1. payvessel-webhook/index.ts's guessed "transfer.success"/
//      "transfer.failed"/"transfer.reversed" event handling (best-effort --
//      unlike reserved_account.credit, Payvessel has never actually been
//      observed sending this webhook for a real payout in this project, so
//      it may simply not fire the way their docs describe).
//   2. THE RELIABLE PATH: the "status" action below, which polls
//      Payvessel's own documented Transfer Status endpoint
//      (docs.payvessel.com/api-reference/transfers/transfer-status) directly
//      by reference/session_id rather than waiting on a webhook. The app
//      calls this itself whenever a pending bank_transfer_out is viewed, so
//      a transfer that already succeeded on Payvessel's side (money in the
//      recipient's bank) stops showing "pending" without needing a webhook
//      at all.
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

    // --- check status of a pending payout (no debit -- read + reconcile) ---
    // Real, documented endpoint (unlike the webhook event names, which
    // were guessed and turned out wrong for reserved_account.credit --
    // this one is called directly so it can't silently drift the same way).
    if (body.action === "status") {
      const reference = body.reference as string | undefined;
      if (!reference) {
        return json({ error: "reference is required" }, { status: 400 });
      }

      // Selecting payvessel_session_id would error outright if
      // add_payout_session_id.sql hasn't been run (unknown column) -- fall
      // back to selecting without it so the status check still works off
      // reference alone rather than 500ing over a missing nice-to-have.
      let txn:
        | { id: string; status: string; amount: number; payvessel_session_id?: string | null }
        | null = null;
      const withSession = await service
        .from("transactions")
        .select("id, status, amount, payvessel_session_id")
        .eq("user_id", user.id)
        .eq("reference", reference)
        .maybeSingle();
      if (withSession.error) {
        const fallback = await service
          .from("transactions")
          .select("id, status, amount")
          .eq("user_id", user.id)
          .eq("reference", reference)
          .maybeSingle();
        txn = fallback.data;
      } else {
        txn = withSession.data;
      }

      if (!txn) {
        return json({ error: "Unknown transaction" }, { status: 404 });
      }
      if (txn.status !== "pending") {
        // Already resolved (by this same check earlier, or by the webhook).
        return json({ status: txn.status });
      }

      const { ok, json: statusJson } = await pvPost("/pms/api/external/request/wallet/transfer-status/", {
        reference,
        session_id: txn.payvessel_session_id ?? undefined,
      });

      // Logged every time, same reasoning as payvessel-webhook: Payvessel's
      // docs have already been wrong once about a real payload shape
      // (reserved_account.credit), so if transfer-status's real response
      // doesn't match data.status the way documented, this is how to see
      // the actual shape and fix the field path -- rather than this action
      // silently reporting "pending" forever for a transfer that already
      // resolved on Payvessel's side.
      console.log("payvessel-payout status check:", reference, "ok:", ok, JSON.stringify(statusJson));

      const pvStatus = (statusJson?.data?.status as string | undefined)?.toLowerCase();
      if (!ok || !statusJson?.status || !pvStatus || pvStatus === "pending") {
        // Still genuinely pending, or Payvessel couldn't be reached this
        // time -- leave the transaction alone, try again later.
        return json({ status: "pending" });
      }

      if (pvStatus === "success" || pvStatus === "successful") {
        await service.from("transactions").update({ status: "successful" }).eq("id", txn.id);
        return json({ status: "successful" });
      }

      // failed/reversed/anything else negative -- refund the wallet, same
      // as the webhook's failure path. `.eq("status", "pending")` +
      // `.select()` here means only whichever call actually flips the row
      // gets a result back, so two near-simultaneous status checks can't
      // double-refund.
      const { data: updated } = await service
        .from("transactions")
        .update({ status: "failed" })
        .eq("id", txn.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (updated) {
        const { data: userRow } = await service.from("users").select("wallet_balance").eq("id", user.id).single();
        if (userRow) {
          await service
            .from("users")
            .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) + Number(txn.amount ?? 0) })
            .eq("id", user.id);
        }
      }
      return json({ status: "failed" });
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

    // Debit now, optimistically -- resolved later either by the webhook
    // (best-effort) or, reliably, by the "status" action above polling
    // Payvessel's real Transfer Status endpoint.
    await service
      .from("users")
      .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - amount })
      .eq("id", user.id);

    // session_id is stored so the "status" action can pass it alongside
    // reference to Transfer Status, per Payvessel's docs.
    const sessionId = transferJson.data?.session_id as string | undefined;

    // A `notify_on_transaction` trigger builds a notification body as
    // `subtitle || ' - ' || sign || amount` -- a null subtitle makes that
    // whole expression null, which violates notifications.body's NOT NULL
    // constraint and silently rolls back this entire insert. Always set one.
    const baseTxn = {
      user_id: user.id,
      type: "bank_transfer_out",
      amount,
      status: "pending",
      reference,
      title: `Bank transfer to ${accountName || accountNumber}`,
      subtitle: `Account ${accountNumber}`,
    };

    // Tries with payvessel_session_id first; if add_payout_session_id.sql
    // hasn't been run yet, Postgrest rejects the unknown column and would
    // otherwise fail this ENTIRE insert (money already left the wallet at
    // this point) -- falls back to inserting without it rather than losing
    // the transaction record over a missing nice-to-have column.
    let txnError: { message: string } | null = null;
    if (sessionId) {
      const res = await service.from("transactions").insert({ ...baseTxn, payvessel_session_id: sessionId });
      txnError = res.error;
      if (txnError) {
        console.error("Insert with payvessel_session_id failed, retrying without it:", txnError);
        const retry = await service.from("transactions").insert(baseTxn);
        txnError = retry.error;
      }
    } else {
      const res = await service.from("transactions").insert(baseTxn);
      txnError = res.error;
    }
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


