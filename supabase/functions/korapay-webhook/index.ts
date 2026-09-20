// Supabase Edge Function: korapay-webhook
// Deploy with: supabase functions deploy korapay-webhook --no-verify-jwt
//
// Kora calls this endpoint directly (no Supabase user session on the
// request), so --no-verify-jwt is required. Set this function's deployed
// URL as your webhook URL in the Kora dashboard (Settings > API
// Configuration).
//
// Secrets required: KORAPAY_SECRET_KEY (same secret key used everywhere
// else -- also used here to verify the signature header), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (already set automatically).
//
// Signature scheme confirmed directly against
// developers.korapay.com/docs/webhooks -- not guessed. Two bugs in the
// previous version of this file are fixed here:
//   1. It used HMAC-SHA512 over the full raw request body. Kora's real
//      scheme is HMAC-SHA256 over ONLY the `data` object (re-stringified),
//      hex-encoded, compared against the `x-korapay-signature` header --
//      using SHA-512 meant every genuine webhook would have been rejected
//      as an invalid signature.
//   2. When no existing `transactions` row matched the incoming reference,
//      it credited wallet_balance to an ARBITRARY first row from `users`
//      (`.limit(1)`) instead of the actual virtual-account owner -- a real
//      deposit could have been misrouted to the wrong customer. Fixed by
//      matching the funded virtual account's account_reference against
//      korapay_accounts to find the real user_id first, mirroring
//      payvessel-webhook's proven pattern for the same problem.
//
// Event shapes (developers.korapay.com/docs/webhooks and
// .../docs/virtual-bank-accounts-ngn):
//   charge.success (NG Virtual Bank Account funding):
//     { event: "charge.success", data: { amount, fee, currency, status,
//       reference, virtual_bank_account_details: { payer_bank_account: {...},
//       virtual_bank_account: { account_reference, account_number, ... } } } }
//   transfer.success / transfer.failed (payout completion):
//     { event: "transfer.success", data: { amount, fee, currency, status,
//       reference } } -- reference matches what korapay-payout generated
//       and stored on the pending bank_transfer_out transaction row.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KORAPAY_SECRET_KEY = Deno.env.get("KORAPAY_SECRET_KEY") ?? "";

async function computeSignature(dataObject: unknown): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(KORAPAY_SECRET_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(dataObject)));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ok200(body: unknown) {
  // Always acknowledge with 200 -- Kora retries periodically for up to 72
  // hours on anything else (or a timeout), which would just cause repeat
  // deliveries of a webhook we've already decided not to act on.
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-korapay-signature") ?? req.headers.get("X-Korapay-Signature");

    const payload = JSON.parse(rawBody);
    console.log("korapay-webhook payload:", JSON.stringify(payload));

    if (!KORAPAY_SECRET_KEY) {
      console.error("korapay-webhook: KORAPAY_SECRET_KEY not set, cannot verify signature");
      return ok200({ status: "ignored: not configured" });
    }

    const expected = await computeSignature(payload.data ?? {});
    if (!signature || signature.toLowerCase() !== expected.toLowerCase()) {
      console.error("korapay-webhook: signature mismatch", { receivedHeaderNames: Array.from(req.headers.keys()) });
      return ok200({ status: "ignored: invalid signature" });
    }

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const event = payload.event as string | undefined;
    const data = payload.data ?? {};

    // --- Virtual account funding (inbound bank transfer) ---
    if (event === "charge.success" && data.virtual_bank_account_details) {
      const accountReference = data.virtual_bank_account_details?.virtual_bank_account?.account_reference as
        | string
        | undefined;
      const reference = data.reference as string | undefined;
      const amount = Number(data.amount ?? 0);

      if (!accountReference || !reference || !amount || amount <= 0) {
        console.log("korapay-webhook: charge.success but missing expected fields", data);
        return ok200({ status: "ignored: incomplete payload" });
      }

      const { data: account } = await service
        .from("korapay_accounts")
        .select("user_id")
        .eq("account_reference", accountReference)
        .maybeSingle();

      if (!account) {
        console.error("korapay-webhook: unknown virtual account", accountReference);
        return ok200({ status: "ignored: unknown virtual account" });
      }

      // Idempotency -- also what makes it safe to retry/resend a delivery.
      const { data: dupe } = await service.from("transactions").select("id").eq("reference", reference).maybeSingle();
      if (dupe) {
        return ok200({ status: "already processed" });
      }

      const { data: userRow } = await service.from("users").select("wallet_balance").eq("id", account.user_id).single();
      if (userRow) {
        await service
          .from("users")
          .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) + amount })
          .eq("id", account.user_id);
      }

      const payerName = data.virtual_bank_account_details?.payer_bank_account?.account_name as string | undefined;
      const payerBank = data.virtual_bank_account_details?.payer_bank_account?.bank_name as string | undefined;
      const subtitle = payerName ? `From ${payerName}${payerBank ? ` (${payerBank})` : ""}` : "Bank transfer";

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
        console.error("korapay-webhook: failed to insert funding transaction:", txnError);
      }

      return ok200({ status: "processed" });
    }

    // --- Payout completion (Transfer to bank) ---
    if (event === "transfer.success" || event === "transfer.failed") {
      const reference = data.reference as string | undefined;
      if (!reference) {
        return ok200({ status: "ignored: missing reference" });
      }

      const { data: txn } = await service
        .from("transactions")
        .select("id, user_id, amount, status")
        .eq("reference", reference)
        .eq("status", "pending")
        .maybeSingle();

      if (!txn) {
        // Either already resolved (e.g. by the status-polling action) or
        // not one of ours -- nothing to do either way.
        return ok200({ status: "ignored: no matching pending transaction" });
      }

      if (event === "transfer.success") {
        await service.from("transactions").update({ status: "successful" }).eq("id", txn.id);
        return ok200({ status: "processed" });
      }

      // transfer.failed -- refund the wallet, same as korapay-payout's own
      // status-polling failure path.
      await service.from("transactions").update({ status: "failed" }).eq("id", txn.id);
      const { data: userRow } = await service.from("users").select("wallet_balance").eq("id", txn.user_id).single();
      if (userRow) {
        await service
          .from("users")
          .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) + Number(txn.amount ?? 0) })
          .eq("id", txn.user_id);
      }
      return ok200({ status: "processed" });
    }

    console.log("korapay-webhook: unhandled event", event);
    return ok200({ status: "ignored: unhandled event" });
  } catch (err) {
    console.error("korapay-webhook error:", err);
    // Still 200 -- an exception here shouldn't trigger endless Kora retries
    // of a payload we've already logged and can investigate from the logs.
    return ok200({ status: "error", message: (err as Error).message });
  }
});
