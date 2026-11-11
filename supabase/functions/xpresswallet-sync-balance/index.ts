// Supabase Edge Function: xpresswallet-sync-balance
// Deploy with: supabase functions deploy xpresswallet-sync-balance
//
// Fallback for when Xpress Wallet's webhook doesn't fire for deposits.
// Called on a schedule (pg_cron + pg_net, see setup_xpresswallet_sync.sql).
// Reads every customer wallet's real `availableBalance` from GET /wallet
// (paged) and compares it to `xpresswallet_accounts.xw_last_balance`, the
// balance we last accounted for:
//   - balance went UP   -> money arrived: credit users.wallet_balance by the
//                          difference and record a fund_wallet transaction.
//   - balance went DOWN -> an outward payout (we already debited locally in
//                          xpresswallet-transfer): just move the baseline.
// The baseline update is an optimistic lock (`where xw_last_balance = old`),
// so two overlapping runs, or the webhook, can never credit the same money
// twice. A brand-new account starts at baseline 0, so money that arrived
// before this ran (e.g. missed webhooks) is credited on the first run.

import { createClient } from "npm:@supabase/supabase-js@2";
import { xwLogin, xwAuthHeaders, XW_BASE_URL } from "../_shared/xpresswallet-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

Deno.serve(async () => {
  try {
    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: accounts, error } = await service
      .from("xpresswallet_accounts")
      .select("id, user_id, xw_wallet_id, xw_last_balance");
    if (error) return json({ error: error.message }, { status: 500 });
    if (!accounts?.length) return json({ checked: 0, credited: 0 });

    const tokens = await xwLogin();

    // Collect real balances for all wallets (paged).
    const balances = new Map<string, number>();
    let prevFirstId = "";
    for (let page = 1; page <= 200; page++) {
      const r = await fetch(`${XW_BASE_URL}/wallet?page=${page}`, { headers: xwAuthHeaders(tokens) });
      const j = await r.json().catch(() => ({}));
      const list: Array<Record<string, unknown>> = Array.isArray(j?.wallets) ? j.wallets : [];
      if (!r.ok || list.length === 0) break;
      const firstId = String(list[0].id ?? "");
      if (firstId && firstId === prevFirstId) break; // pagination ignored, same page again
      prevFirstId = firstId;
      for (const w of list) {
        const bal = Number(w.availableBalance ?? NaN);
        if (w.id && Number.isFinite(bal)) balances.set(String(w.id), bal);
      }
      const totalPages = Number(j?.metadata?.totalPages ?? 1);
      if (page >= totalPages) break;
    }

    let credited = 0;
    for (const acc of accounts) {
      const real = balances.get(String(acc.xw_wallet_id));
      if (real === undefined) continue;
      const last = Number(acc.xw_last_balance ?? 0);
      if (real === last) continue;

      // Claim this change atomically; if another run/webhook got there first,
      // zero rows update and we skip.
      const { data: claimed } = await service
        .from("xpresswallet_accounts")
        .update({ xw_last_balance: real })
        .eq("id", acc.id)
        .eq("xw_last_balance", last)
        .select("id");
      if (!claimed?.length) continue;

      const delta = Math.round((real - last) * 100) / 100;
      if (delta <= 0) continue; // payout/outflow: baseline moved, nothing to credit

      const { data: userRow } = await service
        .from("users")
        .select("wallet_balance")
        .eq("id", acc.user_id)
        .single();
      if (!userRow) continue;

      await service
        .from("users")
        .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) + delta })
        .eq("id", acc.user_id);

      const { error: txnError } = await service.from("transactions").insert({
        user_id: acc.user_id,
        type: "fund_wallet",
        amount: delta,
        status: "successful",
        reference: `XWSYNC-${acc.xw_wallet_id}-${Date.now()}`,
        title: "Wallet funded via bank transfer",
        // Required: the notify_on_transaction trigger builds the notification
        // body from subtitle, and a NULL one makes the whole insert fail.
        subtitle: "Bank transfer to your funding account",
      });
      if (txnError) {
        console.error("xpresswallet-sync-balance: history insert FAILED", txnError.message, txnError.details ?? "");
      }
      credited++;
      console.log("xpresswallet-sync-balance: credited", JSON.stringify({ userId: acc.user_id, delta, real, last }));
    }

    return json({ checked: accounts.length, found: balances.size, credited });
  } catch (err) {
    console.error("xpresswallet-sync-balance error", (err as Error).message);
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
