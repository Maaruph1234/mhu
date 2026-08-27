// Supabase Edge Function: korapay-webhook
// Deploy with: supabase functions deploy korapay-webhook --no-verify-jwt
//
// IMPORTANT: deploy with --no-verify-jwt. Korapay calls this endpoint
// directly (there's no Supabase user session on the request), so
// Supabase's default "reject requests without a valid user JWT" behaviour
// must be turned off for this function specifically.
//
// Secrets required (set with `supabase secrets set ...`):
//   KORAPAY_SECRET_KEY -- same secret key used in korapay-create-account;
//   also used here to verify the x-korapay-signature header.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are already set automatically.
//
// Set this function's deployed URL as your webhook URL in the Kora
// dashboard: Settings > API Configuration > Webhook URL.
//
// Payload shape and signature scheme are both confirmed directly against
// developers.korapay.com/docs/webhooks, developers.korapay.com/docs/
// virtual-bank-accounts-ngn, and developers.korapay.com/docs/payout-via-api
// -- not guessed:
//   - event "charge.success" fires when money lands in a virtual account
//     (wallet funding, handled by korapay-create-account).
//   - event "transfer.success" / "transfer.failed" fires when a payout
//     initiated by korapay-payout (Transfer to bank) finishes -- these
//     resolve the "pending" transaction row that korapay-payout created up
//     front. On failure, the wallet is refunded since it was debited
//     optimistically at initiation time.
//   - header x-korapay-signature = HMAC-SHA256(JSON.stringify(data), secretKey)
//     hex-encoded, where `data` is exactly the `data` object in the payload.
//   - data.virtual_bank_account_details.virtual_bank_account.account_reference
//     is the same account_reference we set when creating the account
//     (mhu-<user_id>), which is how we find who to credit for charge.success.

import { createClient } from "npm:@supabase/supabase-js@2";

const KORAPAY_SECRET_KEY = Deno.env.get("KORAPAY_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function verifySignature(dataObj: unknown, signature: string | null): Promise<boolean> {
  if (!signature || !KORAPAY_SECRET_KEY) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(KORAPAY_SECRET_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(dataObj)));
  const computed = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computed === signature;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const signature = req.headers.get("x-korapay-signature");

    const isValid = await verifySignature(payload?.data, signature);
    if (!isValid) {
      // Acknowledge with 200 so Korapay doesn't endlessly retry a request
      // that will never become valid, but do nothing with it.
      return new Response(JSON.stringify({ status: "ignored: invalid signature" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const data = payload.data ?? {};

    // --- payout (Transfer to bank) resolving ---
    if (payload?.event === "transfer.success" || payload?.event === "transfer.failed") {
      const reference = data.reference;
      if (!reference) {
        return new Response(JSON.stringify({ error: "Missing reference" }), { status: 400 });
      }

      const { data: txn } = await service
        .from("transactions")
        .select("id, user_id, amount, status")
        .eq("reference", reference)
        .maybeSingle();

      if (!txn) {
        return new Response(JSON.stringify({ error: "Unknown transaction" }), { status: 404 });
      }

      // Idempotency: a "pending" row is what korapay-payout leaves behind;
      // if it's already resolved, a duplicate webhook delivery shouldn't
      // refund/re-process it a second time.
      if (txn.status !== "pending") {
        return new Response(
          JSON.stringify({ status: "already processed" }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (payload.event === "transfer.success") {
        await service.from("transactions").update({ status: "successful" }).eq("id", txn.id);
      } else {
        // Failed payout -- refund the wallet, since korapay-payout debited
        // it optimistically at initiation time.
        await service.from("transactions").update({ status: "failed" }).eq("id", txn.id);
        const { data: userRow } = await service
          .from("users")
          .select("wallet_balance")
          .eq("id", txn.user_id)
          .single();
        if (userRow) {
          await service
            .from("users")
            .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) + Number(txn.amount ?? 0) })
            .eq("id", txn.user_id);
        }
      }

      return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
    }

    if (payload?.event !== "charge.success") {
      // Anything else (including charge.failed): nothing to credit.
      return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
    }
    const amount = Number(data.amount ?? 0);
    const reference = data.reference ?? `KPY-${Date.now()}`;
    const accountReference = data?.virtual_bank_account_details?.virtual_bank_account?.account_reference;

    if (!accountReference || !amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Missing account_reference or amount" }), { status: 400 });
    }

    const { data: account } = await service
      .from("korapay_accounts")
      .select("user_id")
      .eq("account_reference", accountReference)
      .maybeSingle();

    if (!account) {
      return new Response(JSON.stringify({ error: "Unknown virtual account" }), { status: 404 });
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

    // A `notify_on_transaction` trigger builds a notification body as
    // `subtitle || ' - ' || sign || amount` -- a null subtitle makes that
    // whole expression null, which violates notifications.body's NOT NULL
    // constraint and silently rolls back this entire insert. Always set one.
    const payerName = data?.virtual_bank_account_details?.payer_bank_account?.account_name;
    const subtitle = payerName ? `From ${payerName}` : "Bank transfer";

    const { error: txnError } = await service.from("transactions").insert({
      user_id: account.user_id,
      type: "fund_wallet",
      amount,
      status: "successful",
      reference,
      title: "Wallet funded via bank transfer",
      subtitle,
    });
    if (txnError) {
      console.error("Failed to insert transaction record:", txnError);
    }

    return new Response(JSON.stringify({ status: "ok", txnLogError: txnError?.message }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
