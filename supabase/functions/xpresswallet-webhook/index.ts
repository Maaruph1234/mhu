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
// on your Xpress Wallet merchant profile (PATCH /merchant/profile — see
// developer.providusbank.com/xpress-wallet-api/merchant/update-merchant-profile),
// with your chosen secret appended as a query param, e.g.:
//   https://YOUR_PROJECT.functions.supabase.co/xpresswallet-webhook?secret=YOUR_SECRET
//
// IMPORTANT — the real webhook payload shape is NOT publicly documented
// (unlike Korapay, whose docs spell out `data`'s exact shape). This handler
// is written defensively as a result:
//   1. The full raw payload is stored in `xpresswallet_webhook_events` on
//      every call, whether or not it can be understood, so the real shape
//      can be confirmed from actual delivered payloads instead of guessed
//      at again later.
//   2. It matches the account by wallet id / account number / customer id
//      (trying several plausible field paths), never by anything that
//      could resolve to an arbitrary user — same principle as the fix that
//      was needed for korapay-webhook's original draft.
//   3. It only credits `users.wallet_balance` for a positive amount it can
//      actually find on the payload; if the shape doesn't match anything
//      expected, it stores the raw event for inspection and returns 200
//      without crediting anyone, rather than guessing.

import { createClient } from "npm:@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("XPRESSWALLET_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function ok200(body: Record<string, unknown>) {
  // Always answer 200 once the secret has checked out, even on a shape we
  // couldn't fully process -- returning an error status just makes Xpress
  // Wallet retry the same unparseable payload forever.
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (WEBHOOK_SECRET && url.searchParams.get("secret") !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: "Invalid webhook secret" }), { status: 401 });
    }

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = await req.json().catch(() => ({}));

    // Best-effort audit trail of every delivery, regardless of whether the
    // rest of this function can make sense of it.
    await service.from("xpresswallet_webhook_events").insert({ payload }).select().maybeSingle();

    // Try every plausible field path for the wallet/customer/account
    // identifier and the credited amount -- the docs don't confirm which
    // one Xpress Wallet actually sends.
    const walletId: string | undefined =
      payload?.wallet?.id ?? payload?.walletId ?? payload?.data?.wallet?.id ?? payload?.data?.walletId;
    const customerId: string | undefined =
      payload?.customer?.id ?? payload?.customerId ?? payload?.data?.customer?.id ?? payload?.data?.customerId;
    const accountNumber: string | undefined =
      payload?.wallet?.accountNumber ?? payload?.accountNumber ?? payload?.data?.accountNumber;
    const amount = Number(
      payload?.amount ?? payload?.transaction?.amount ?? payload?.data?.amount ?? payload?.data?.transaction?.amount ?? 0
    );
    const reference: string =
      payload?.reference ??
      payload?.transaction?.reference ??
      payload?.data?.reference ??
      `XW-${Date.now()}`;
    const eventType: string | undefined = payload?.event ?? payload?.type ?? payload?.data?.event;

    // Only act on what looks like a deposit/credit notification. If Xpress
    // Wallet also fires webhooks for other event types (transfer status,
    // etc.), ignore them here rather than guessing at a debit.
    if (eventType && /debit|failed|transfer/i.test(eventType) && !/credit|deposit/i.test(eventType)) {
      return ok200({ status: "ignored", reason: "not a credit event" });
    }

    if (!walletId && !customerId && !accountNumber) {
      return ok200({ status: "stored", reason: "no identifiable wallet/customer/account on payload" });
    }
    if (!amount || amount <= 0) {
      return ok200({ status: "stored", reason: "no positive amount on payload" });
    }

    let query = service.from("xpresswallet_accounts").select("user_id");
    if (walletId) query = query.eq("xw_wallet_id", walletId);
    else if (customerId) query = query.eq("xw_customer_id", customerId);
    else query = query.eq("account_number", accountNumber);
    const { data: account } = await query.maybeSingle();

    if (!account) {
      return ok200({ status: "stored", reason: "no matching xpresswallet_accounts row" });
    }

    // Idempotency: skip if this reference has already been recorded, so a
    // retried/duplicate webhook delivery can't double-credit the wallet.
    const { data: dupe } = await service
      .from("transactions")
      .select("id")
      .eq("reference", reference)
      .maybeSingle();
    if (dupe) {
      return ok200({ status: "already processed" });
    }

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

    return ok200({ status: "ok" });
  } catch (err) {
    // Still 200 -- an unhandled shape shouldn't make Xpress Wallet hammer
    // retries on something that will never succeed differently.
    return ok200({ status: "error", message: (err as Error).message });
  }
});
