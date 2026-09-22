// Supabase Edge Function: xpresswallet-transfer
// Deploy with: supabase functions deploy xpresswallet-transfer
// Secrets required: XPRESSWALLET_BASE_URL, XPRESSWALLET_EMAIL,
//   XPRESSWALLET_PASSWORD, XPRESSWALLET_PRIVATE_KEY (see
//   _shared/xpresswallet-auth.ts for what each does)
//
// "Transfer to bank" -- sending money OUT of a user's real Xpress Wallet
// (Providus Bank) sub-account to an external Nigerian bank account.
// Endpoints/fields confirmed directly against developer.providusbank.com's
// live Xpress Wallet API docs, not guessed:
//   - GET  /transfer/banks
//     -> { banks: [{ code, name }] }
//   - GET  /transfer/account/details?sortCode=&accountNumber=
//     -> { account: { bankCode, accountName, accountNumber } }
//   - POST /transfer/bank/customer
//     { amount, sortCode, narration, accountNumber, accountName, customerId }
//     -> { message: "Transaction successfully completed.",
//          transfer: { reference, transactionReference, amount, charges, ... } }
//
// Unlike Korapay's payout (POST /transactions/disburse, which returns
// "processing" and resolves later via webhook), this endpoint's docs show
// it responding with "Transaction successfully completed." directly in the
// same call -- there's no documented single-transaction status-by-reference
// endpoint the way Korapay's payout history search worked either. So this
// function treats the transfer as SYNCHRONOUS: the wallet is only debited
// AFTER Xpress Wallet confirms success, and the transaction is recorded
// "successful" immediately rather than "pending" awaiting a webhook. If a
// real transfer ever does come back ambiguous, it's recorded "pending" and
// the wallet is NOT debited, erring toward "customer keeps their money"
// rather than risking a double-charge.
//
// CORS: called directly from the browser, same reasoning as the korapay-*
// functions it replaces.

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
    const tokens = await xwLogin();

    if (body.action === "banks") {
      const res = await fetch(`${XW_BASE_URL}/transfer/banks`, { headers: xwAuthHeaders(tokens) });
      const banksJson = await res.json();
      if (!res.ok || !banksJson?.status) {
        return json({ error: banksJson?.message ?? "Could not load bank list" }, { status: 502 });
      }
      const banks = Array.isArray(banksJson.banks) ? banksJson.banks : [];
      return json({
        banks: banks.map((b: { name?: string; code?: string }) => ({ name: b.name ?? "Bank", code: b.code ?? "" })),
      });
    }

    if (body.action === "resolve") {
      const { bankCode, accountNumber } = body;
      if (!bankCode || !accountNumber) {
        return json({ error: "bankCode and accountNumber are required" }, { status: 400 });
      }
      const res = await fetch(
        `${XW_BASE_URL}/transfer/account/details?sortCode=${encodeURIComponent(bankCode)}&accountNumber=${encodeURIComponent(accountNumber)}`,
        { headers: xwAuthHeaders(tokens) }
      );
      const resolveJson = await res.json();
      if (!res.ok || !resolveJson?.status) {
        return json({ error: resolveJson?.message ?? "Could not resolve that account" }, { status: 502 });
      }
      return json({ accountName: resolveJson.account?.accountName ?? "" });
    }

    if (body.action === "status") {
      const reference = body.reference as string | undefined;
      if (!reference) {
        return json({ error: "reference is required" }, { status: 400 });
      }
      // No documented single-transaction status lookup on Xpress Wallet's
      // side -- the transfer is synchronous (see header comment), so
      // whatever status we recorded at initiation time is authoritative.
      const { data: txn } = await service
        .from("transactions")
        .select("status")
        .eq("user_id", user.id)
        .eq("reference", reference)
        .maybeSingle();
      return json({ status: txn?.status ?? "pending" });
    }

    // Default action: initiate a transfer.
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

    const { data: xwAccount } = await service
      .from("xpresswallet_accounts")
      .select("xw_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!xwAccount?.xw_customer_id) {
      return json({ error: "Set up your Xpress Wallet funding account first (Fund Wallet)" }, { status: 400 });
    }

    const reference = generateReference();
    const res = await fetch(`${XW_BASE_URL}/transfer/bank/customer`, {
      method: "POST",
      headers: xwAuthHeaders(tokens, { withPrivateKey: true }),
      body: JSON.stringify({
        amount: Number(amount.toFixed(2)),
        sortCode: bankCode,
        narration: narration || "MHU Global bank transfer",
        accountNumber,
        accountName: accountName || userRow.display_name || "MHU User",
        customerId: xwAccount.xw_customer_id,
        metadata: { reference },
      }),
    });
    const transferJson = await res.json();

    if (!res.ok || !transferJson?.status) {
      const baseTxn = {
        user_id: user.id,
        type: "bank_transfer_out",
        amount,
        status: "failed",
        reference,
        title: `Bank transfer to ${accountName || accountNumber}`,
        subtitle: `Account ${accountNumber}`,
      };
      await service.from("transactions").insert(baseTxn);
      return json({ error: transferJson?.message ?? "Bank transfer could not be initiated" }, { status: 502 });
    }

    // Confirmed successful -- debit now, not optimistically beforehand (see
    // header comment on why this differs from korapay-payout).
    await service
      .from("users")
      .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - amount })
      .eq("id", user.id);

    const realReference = transferJson.transfer?.reference ?? reference;

    await service.from("transactions").insert({
      user_id: user.id,
      type: "bank_transfer_out",
      amount,
      status: "successful",
      reference: realReference,
      title: `Bank transfer to ${accountName || accountNumber}`,
      subtitle: `Account ${accountNumber}`,
    });

    return json({
      success: true,
      reference: realReference,
      message: transferJson.message ?? "Bank transfer completed",
    });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
