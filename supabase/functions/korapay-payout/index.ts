// Supabase Edge Function: korapay-payout
// Deploy with: supabase functions deploy korapay-payout
// Secrets required: KORAPAY_SECRET_KEY, KORAPAY_BASE_URL
//
// "Transfer to bank" -- sending money OUT of a user's MHU wallet to an
// external Nigerian bank account, via Kora's Payout API. Endpoints/fields
// confirmed directly against developers.korapay.com/docs/payout-via-api --
// not guessed (the previous version of this file invented endpoints --
// /merchant/api/v1/banks, /merchant/api/v1/account/resolve,
// /merchant/api/v1/payout, /merchant/api/v1/payout/status -- none of which
// exist in Kora's real API):
//   - GET  /merchant/api/v1/misc/banks?countryCode=NG
//     -> { data: [{ name, slug, code, country }] }
//   - POST /merchant/api/v1/misc/banks/resolve
//     { bank, account, currency } -> { data: { account_name, bank_name, ... } }
//   - POST /merchant/api/v1/transactions/disburse
//     { reference, destination: { type: "bank_account", amount, currency,
//       narration, bank_account: { bank, account }, customer: { name, email } } }
//     -> { data: { status: "processing", reference, amount, fee, ... } }
//
// A payout response of "processing" does NOT mean the money has definitely
// moved -- the wallet is debited up front here (optimistically) but a
// "pending" transaction row is left in place until the real outcome is
// known, resolved one of two ways:
//   1. korapay-webhook/index.ts's "transfer.success"/"transfer.failed"
//      events -- this IS Kora's own documented mechanism for payout
//      completion (developers.korapay.com/docs/payout-via-api, "Step 4 -
//      Receive confirmation via webhook"), unlike Payvessel's equivalent
//      webhook which was never observed firing for a real payout in this
//      project. This is the authoritative path.
//   2. The "status" action below, a best-effort poll via the documented
//      Payout History API (GET /merchant/api/v1/payouts) searched for a
//      matching reference. Kora's docs don't show a dedicated "get single
//      payout by reference" endpoint the way Payvessel's Transfer Status
//      one worked, so this defensively falls back to "pending" if it can't
//      find a confident match rather than ever guessing successful/failed --
//      the webhook is what actually resolves a transfer either way.
//
// CORS: called directly from the browser, same reasoning as
// korapay-create-account/index.ts.

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

function generateReference(): string {
  // Kora requires at least 5 characters -- this is comfortably longer.
  return `TRFBANK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function koraGet(path: string) {
  const res = await fetch(`${KORAPAY_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${KORAPAY_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
  });
  return { ok: res.ok, status: res.status, json: await res.json() };
}

async function koraPost(path: string, body: unknown) {
  const res = await fetch(`${KORAPAY_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KORAPAY_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, json: await res.json() };
}

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

    const body = await req.json();

    if (body.action === "banks") {
      const { ok, json: banksJson } = await koraGet("/merchant/api/v1/misc/banks?countryCode=NG");
      if (!ok || !banksJson?.status) {
        return json({ error: banksJson?.message ?? "Could not load bank list" }, { status: 502 });
      }
      const banks = Array.isArray(banksJson.data) ? banksJson.data : [];
      return json({
        banks: banks.map((b: { name?: string; code?: string }) => ({
          name: b.name ?? "Bank",
          code: b.code ?? "",
        })),
      });
    }

    if (body.action === "resolve") {
      const { bankCode, accountNumber } = body;
      if (!bankCode || !accountNumber) {
        return json({ error: "bankCode and accountNumber are required" }, { status: 400 });
      }

      const { ok, json: resolveJson } = await koraPost("/merchant/api/v1/misc/banks/resolve", {
        bank: bankCode,
        account: accountNumber,
        currency: "NGN",
      });
      if (!ok || !resolveJson?.status) {
        return json({ error: resolveJson?.message ?? "Could not resolve that account" }, { status: 502 });
      }

      const data = resolveJson.data ?? {};
      return json({ accountName: data.account_name ?? "" });
    }

    if (body.action === "status") {
      const reference = body.reference as string | undefined;
      if (!reference) {
        return json({ error: "reference is required" }, { status: 400 });
      }

      const { data: txn } = await service
        .from("transactions")
        .select("id, status, amount")
        .eq("user_id", user.id)
        .eq("reference", reference)
        .maybeSingle();

      if (!txn) {
        return json({ error: "Unknown transaction" }, { status: 404 });
      }
      if (txn.status !== "pending") {
        return json({ status: txn.status });
      }

      // Best-effort poll -- see header comment. Never resolves to
      // successful/failed on ambiguous data; only the webhook does that
      // with confidence.
      try {
        const { ok, json: historyJson } = await koraGet(
          `/merchant/api/v1/payouts?limit=50`
        );
        const rows: Array<Record<string, unknown>> = Array.isArray(historyJson?.data)
          ? historyJson.data
          : historyJson?.data
          ? [historyJson.data]
          : [];
        const match = ok ? rows.find((r) => r.reference === reference) : undefined;
        const kvStatus = String(match?.status ?? "").toLowerCase();

        if (kvStatus === "success" || kvStatus === "successful") {
          await service.from("transactions").update({ status: "successful" }).eq("id", txn.id);
          return json({ status: "successful" });
        }
        if (kvStatus === "failed" || kvStatus === "reversed") {
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
      } catch (_e) {
        // Swallow -- fall through to "pending" below. The webhook remains
        // the authoritative path regardless of whether this poll works.
      }

      return json({ status: "pending" });
    }

    const { bankCode, accountNumber, accountName, narration } = body;
    const amount = Number(body.amount ?? 0);

    if (!bankCode || !accountNumber || !amount || amount <= 0) {
      return json({ error: "bankCode, accountNumber, and a valid amount are required" }, { status: 400 });
    }

    const { data: userRow } = await service.from("users").select("wallet_balance, display_name, email").eq("id", user.id).single();
    if (!userRow || Number(userRow.wallet_balance ?? 0) < amount) {
      return json({ error: "Insufficient wallet balance" }, { status: 402 });
    }

    const reference = generateReference();
    const { ok, json: transferJson } = await koraPost("/merchant/api/v1/transactions/disburse", {
      reference,
      destination: {
        type: "bank_account",
        amount: Number(amount.toFixed(2)),
        currency: "NGN",
        narration: narration || "MHU Global bank transfer",
        bank_account: {
          bank: bankCode,
          account: accountNumber,
        },
        customer: {
          name: accountName || userRow.display_name || "MHU User",
          email: userRow.email,
        },
      },
    });

    if (!ok || !transferJson?.status) {
      return json({ error: transferJson?.message ?? "Bank transfer could not be initiated" }, { status: 502 });
    }

    await service.from("users").update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - amount }).eq("id", user.id);

    const baseTxn = {
      user_id: user.id,
      type: "bank_transfer_out",
      amount,
      status: "pending",
      reference,
      title: `Bank transfer to ${accountName || accountNumber}`,
      subtitle: `Account ${accountNumber}`,
    };

    const { error: insertError } = await service.from("transactions").insert(baseTxn);
    if (insertError) {
      console.error("Failed to insert transaction record:", insertError);
    }

    return json({
      success: true,
      reference,
      message: transferJson.data?.message ?? transferJson.message ?? "Bank transfer initiated",
    });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
