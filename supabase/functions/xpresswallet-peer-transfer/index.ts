// Supabase Edge Function: xpresswallet-peer-transfer
// Deploy with: supabase functions deploy xpresswallet-peer-transfer
//
// MHU-user-to-MHU-user transfer that moves the REAL money between the two
// users' Xpress Wallet sub-wallets (POST /transfer/wallet,
// customer-to-customer) and then mirrors it on the local ledger. Before
// this, peer transfers only changed users.wallet_balance, so real Xpress
// Wallet balances drifted from app balances and payouts could fail
// "insufficient balance".
//
// Order matters: the real transfer happens FIRST; local balances change only
// after Xpress Wallet confirms. Both users' xw_last_balance baselines are
// adjusted too, so xpresswallet-sync-balance (which credits real-balance
// increases) never counts this transfer as a new deposit. Each baseline move
// is an optimistic lock; if the sync already moved a baseline in the tiny
// window since the transfer, we skip that side's local credit/debit because
// the sync has already accounted for it.
//
// If either user has no Xpress Wallet account yet, there is no real money to
// move, so it falls back to the old local-only transfer_funds RPC.
//
// Body: { identifier: string (phone or email), amount: number, note?: string }
// CORS: called straight from the browser / Flutter app.

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

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, { status: 401 });

    const body = await req.json();
    const identifier = String(body.identifier ?? "").trim();
    const note = body.note ? String(body.note).slice(0, 120) : null;
    const amount = round2(Number(body.amount ?? 0));
    if (!identifier || !Number.isFinite(amount) || amount <= 0) {
      return json({ error: "A recipient and a valid amount are required" }, { status: 400 });
    }

    // ---- find the recipient (same rules as the transfer_funds RPC) ----
    let recipient: { id: string; display_name: string | null } | null = null;
    if (identifier.includes("@")) {
      const { data } = await service.from("users").select("id, display_name").eq("email", identifier).limit(1);
      recipient = data?.[0] ?? null;
    } else {
      const digits = identifier.replace(/\D/g, "");
      if (digits.length >= 7) {
        const { data } = await service
          .from("users")
          .select("id, display_name")
          .like("phone_number", `%${digits.slice(-10)}`)
          .limit(1);
        recipient = data?.[0] ?? null;
      }
    }
    if (!recipient) return json({ error: "Recipient not found" }, { status: 404 });
    if (recipient.id === user.id) return json({ error: "Cannot transfer to yourself" }, { status: 400 });

    // ---- do both users have real Xpress Wallet accounts? ----
    const { data: accounts } = await service
      .from("xpresswallet_accounts")
      .select("user_id, xw_customer_id")
      .in("user_id", [user.id, recipient.id]);
    const senderAcc = accounts?.find((a) => a.user_id === user.id);
    const recipientAcc = accounts?.find((a) => a.user_id === recipient!.id);

    if (!senderAcc?.xw_customer_id || !recipientAcc?.xw_customer_id) {
      // No real wallet on one side -> nothing real to move. Old local-only path.
      const { data, error } = await userClient.rpc("transfer_funds", {
        p_identifier: identifier,
        p_amount: amount,
        p_note: note,
      });
      if (error) return json({ error: error.message }, { status: 400 });
      return json({ success: true, reference: data?.reference ?? "", fee: 0, local: true });
    }

    // ---- local checks before touching real money ----
    const { data: senderRow } = await service
      .from("users")
      .select("wallet_balance, display_name")
      .eq("id", user.id)
      .single();
    if (!senderRow || num(senderRow.wallet_balance) < amount) {
      return json({ error: "Insufficient balance" }, { status: 402 });
    }
    const { error: limitErr } = await service.rpc("check_daily_transfer_limit", {
      p_user_id: user.id,
      p_amount: amount,
    });
    if (limitErr) return json({ error: limitErr.message }, { status: 400 });
    const { error: capErr } = await service.rpc("check_balance_cap", {
      p_user_id: recipient.id,
      p_additional_amount: amount,
    });
    if (capErr) return json({ error: capErr.message }, { status: 400 });

    // ---- the real transfer ----
    const tokens = await xwLogin();
    const res = await fetch(`${XW_BASE_URL}/transfer/wallet`, {
      method: "POST",
      headers: xwAuthHeaders(tokens, { withPrivateKey: true }),
      body: JSON.stringify({
        amount,
        fromCustomerId: senderAcc.xw_customer_id,
        toCustomerId: recipientAcc.xw_customer_id,
      }),
    });
    const xw = await res.json().catch(() => ({}));
    console.log("xpresswallet-peer-transfer: response", JSON.stringify({ http: res.status, body: xw }));

    if (!res.ok || !xw?.status) {
      const reason = String(xw?.message ?? `HTTP ${res.status}`);
      console.error("xpresswallet-peer-transfer: failed", reason);
      return json(
        {
          error: /insufficient/i.test(reason)
            ? "Transfer couldn't be completed right now. Please try again shortly."
            : `Transfer failed: ${reason.slice(0, 120)}`,
        },
        { status: 502 }
      );
    }

    // ---- confirmed: mirror it locally ----
    const d = (xw.data ?? {}) as Record<string, unknown>;
    const fee = round2(num(d.transaction_fee));
    const totalDebit = round2(num(d.total) > 0 ? num(d.total) : amount + fee);
    const reference = String(d.reference ?? `PEER-${Date.now()}`);

    // Adjust a user's sync baseline by `delta`. Returns true if we claimed it
    // (so we should apply the local change); false if the sync got there first.
    async function moveBaseline(userId: string, delta: number): Promise<boolean> {
      for (let i = 0; i < 3; i++) {
        const { data: row } = await service
          .from("xpresswallet_accounts")
          .select("xw_last_balance")
          .eq("user_id", userId)
          .single();
        const last = num(row?.xw_last_balance);
        const { data: claimed } = await service
          .from("xpresswallet_accounts")
          .update({ xw_last_balance: round2(last + delta) })
          .eq("user_id", userId)
          .eq("xw_last_balance", last)
          .select("user_id");
        if (claimed?.length) return true;
      }
      return false;
    }

    const senderClaimed = await moveBaseline(user.id, -totalDebit);
    const recipientClaimed = await moveBaseline(recipient.id, amount);

    if (senderClaimed) {
      await service
        .from("users")
        .update({ wallet_balance: Math.max(0, round2(num(senderRow.wallet_balance) - totalDebit)) })
        .eq("id", user.id);
    }
    if (recipientClaimed) {
      const { data: rRow } = await service.from("users").select("wallet_balance").eq("id", recipient.id).single();
      await service
        .from("users")
        .update({ wallet_balance: round2(num(rRow?.wallet_balance) + amount) })
        .eq("id", recipient.id);
    }

    // subtitle must never be NULL: the notify_on_transaction trigger builds
    // the notification body from it and fails the whole insert otherwise.
    await service.from("transactions").insert({
      user_id: user.id,
      type: "transfer_out",
      amount,
      status: "successful",
      reference,
      title: "Transfer sent",
      subtitle: note ?? `Transfer to ${recipient.display_name ?? identifier}${fee > 0 ? ` (fee ₦${fee})` : ""}`,
    });
    await service.from("transactions").insert({
      user_id: recipient.id,
      type: "transfer_in",
      amount,
      status: "successful",
      reference: `${reference}-IN`,
      title: "Transfer received",
      subtitle: note ?? `Transfer from ${senderRow.display_name ?? "an MHU user"}`,
    });

    return json({ success: true, reference, fee });
  } catch (err) {
    console.error("xpresswallet-peer-transfer error", (err as Error).message);
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
