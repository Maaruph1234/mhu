// Supabase Edge Function: payvessel-webhook
// Deploy with: supabase functions deploy payvessel-webhook --no-verify-jwt
//
// Replaces korapay-webhook. Payvessel calls this endpoint directly (no
// Supabase user session on the request), so --no-verify-jwt is required.
//
// Secrets required: PAYVESSEL_SECRET (same secret used everywhere else,
// also used here to verify the signature header), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (already set automatically).
//
// Set this function's deployed URL as your webhook URL in the Payvessel
// dashboard.
//
// Signature scheme confirmed directly against
// docs.payvessel.com/api-reference/webhook/verifying-webhooks -- not
// guessed: HMAC-SHA512 of the RAW request body, using your secret
// (PVSECRET-...) as the key, hex-encoded, compared against a signature
// header. Their own docs' code samples read it via Django's
// `HTTP_PAYVESSEL_HTTP_SIGNATURE` META key, which is Django's automatic
// "HTTP_" + uppercased-and-underscored transform of an actual wire header
// -- meaning the real header Payvessel sends is most likely
// "Payvessel-Http-Signature". Checked defensively against a couple of
// plausible header names below since the docs never show the literal wire
// name; if verification always fails, log the actual header the first real
// webhook delivery arrives with and adjust the header name checked here.
//
// Reserved-account credit (inbound bank transfer): confirmed from REAL
// production webhook deliveries on 2026-09-10 (via function logs) that
// this payload has NO "event" field at all -- unlike the
// "reserved_account.credit" shape guessed from Payvessel's generic docs
// (which don't actually document this event's payload). It's detected
// instead by the presence of virtualAccount/transaction/order, which is
// how these payloads identify themselves. Real confirmed example:
//   {"transaction":{"date":"...","reference":"1000332...PP","external_reference":"...","sessionid":"..."},
//    "order":{"currency":"NGN","amount":"1500","fee":"15.00","description":"...","settlement_amount":"1485.00"},
//    "customer":{"email":"...","phone":"..."},
//    "virtualAccount":{"virtualAccountNumber":"6656640533","virtualBank":"999991"},
//    "sender":{"senderAccountNumber":"...","senderBankName":"...","senderName":"...","SenderBankCode":null},
//    "message":"Success","code":"00"}
// Matched to our account by virtualAccount.virtualAccountNumber against
// payvessel_accounts.account_number (there's no trackingReference in this
// real shape at all, despite that being what the old guessed code kept
// looking for). Credited on the gross order.amount (matches what
// FundWallet shows the user, same as the old guessed logic did) --
// order.fee/settlement_amount is Payvessel's own collection fee, absorbed
// by the business rather than passed to the user.
//
// The full raw payload is still logged on every call so any future shape
// mismatch (e.g. for transfer.success/issuing.* events, which haven't been
// seen for real yet and still rely on the guessed "event"-keyed shape
// below) is diagnosable the same way this one was.
//
// Also handles virtual-card issuing events (docs.payvessel.com/virtual-
// cards/webhooks): `issuing.created.successful` / `issuing.created.failed`
// (card provisioning finished), `issuing.terminated` (card closed, refunds
// remaining balance), and `card.transaction` with event_type
// `contactless_fee` / `cross_border_fee` (a fee Payvessel couldn't collect
// from the card itself, billed to our business wallet instead -- recovered
// here from the card owner's NGN wallet). Note: Payvessel's create-card
// request has no client-supplied `reference` field in its documented
// schema, yet `issuing.created.failed` payloads only carry `reference` (no
// `card_id`) -- there's no reliable way to match a failed creation back to
// a specific row from the webhook alone. Rather than guess, this handler
// only acts on `issuing.created.successful` (which does carry `card.id`);
// a card stuck on PENDING is instead self-healed the next time the user
// opens their Cards screen, since payvessel-cards' "get" action always
// live-refreshes status from Payvessel directly.

import { createClient } from "npm:@supabase/supabase-js@2";

const PAYVESSEL_SECRET = Deno.env.get("PAYVESSEL_SECRET") ?? "";
// Same manually-maintained rate used by payvessel-cards -- see that file's
// header comment for why this isn't a live FX feed.
const RATE = Number(Deno.env.get("PAYVESSEL_USD_NGN_RATE")) || 1500;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function computeSignature(rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYVESSEL_SECRET),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Digs through a few plausible nesting shapes for a value, since Payvessel's
// docs don't publish a concrete example for reserved_account.credit.
function pick(obj: Record<string, unknown>, paths: string[][]): unknown {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path) {
      if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[key];
      else {
        cur = undefined;
        break;
      }
    }
    if (cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

Deno.serve(async (req) => {
  try {
    const rawBody = await req.text();
    const signature =
      req.headers.get("payvessel-http-signature") ??
      req.headers.get("x-payvessel-signature") ??
      req.headers.get("http_payvessel_http_signature");

    const expected = await computeSignature(rawBody);
    if (!signature || signature.toLowerCase() !== expected.toLowerCase()) {
      console.error("payvessel-webhook: signature mismatch", {
        receivedHeaderNames: Array.from(req.headers.keys()),
      });
      // Acknowledge with 200 so Payvessel doesn't endlessly retry a request
      // that will never become valid, but do nothing with it.
      return new Response(JSON.stringify({ status: "ignored: invalid signature" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody);
    console.log("payvessel-webhook payload:", JSON.stringify(payload));

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- reserved account credit (inbound bank transfer) ---
    // Checked first, by field presence rather than an "event" key -- see
    // the header comment above for why. Real deliveries confirmed
    // code: "00" / message: "Success" on the successful ones; treated
    // defensively as the only acceptable "this is a real credit" signal.
    {
      const virtualAccountNumber = pick(payload, [
        ["virtualAccount", "virtualAccountNumber"],
      ]) as string | undefined;
      const txnReference = pick(payload, [["transaction", "reference"]]) as string | undefined;
      const orderAmount = pick(payload, [["order", "amount"]]) as string | undefined;

      if (virtualAccountNumber && txnReference && orderAmount) {
        const amount = Number(orderAmount);
        if (payload?.code !== "00" || !amount || amount <= 0) {
          console.log("payvessel-webhook: credit-shaped payload but not a successful credit", payload);
          return new Response(JSON.stringify({ status: "ignored: not a successful credit" }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        const { data: account } = await service
          .from("payvessel_accounts")
          .select("user_id")
          .eq("account_number", virtualAccountNumber)
          .maybeSingle();

        if (!account) {
          console.error("payvessel-webhook: unknown virtual account", virtualAccountNumber);
          return new Response(JSON.stringify({ error: "Unknown virtual account" }), { status: 404 });
        }

        // Idempotency: skip if this reference has already been recorded --
        // also what makes it safe to backfill missed deliveries by hand.
        const { data: dupe } = await service
          .from("transactions")
          .select("id")
          .eq("reference", txnReference)
          .maybeSingle();
        if (dupe) {
          return new Response(JSON.stringify({ status: "already processed" }), {
            headers: { "Content-Type": "application/json" },
          });
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

        const senderName = pick(payload, [["sender", "senderName"]]) as string | undefined;
        const senderBank = pick(payload, [["sender", "senderBankName"]]) as string | undefined;
        const subtitle = senderName ? `From ${senderName}${senderBank ? ` (${senderBank})` : ""}` : "Bank transfer";

        const { error: txnError } = await service.from("transactions").insert({
          user_id: account.user_id,
          type: "fund_wallet",
          amount,
          status: "successful",
          reference: txnReference,
          title: "Wallet funded via bank transfer",
          subtitle,
        });
        if (txnError) {
          console.error("Failed to insert transaction record:", txnError);
        }

        return new Response(JSON.stringify({ status: "ok", txnLogError: txnError?.message }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // --- payout (Transfer to bank) resolving ---
    if (payload?.event === "transfer.success" || payload?.event === "transfer.failed" || payload?.event === "transfer.reversed") {
      const reference = pick(payload, [["data", "reference"], ["reference"]]) as string | undefined;
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
      if (txn.status !== "pending") {
        return new Response(JSON.stringify({ status: "already processed" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (payload.event === "transfer.success") {
        await service.from("transactions").update({ status: "successful" }).eq("id", txn.id);
      } else {
        // Failed/reversed payout -- refund the wallet, since payvessel-payout
        // debited it optimistically at initiation time.
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

    // --- virtual card: creation finished ---
    if (payload?.event === "issuing.created.successful") {
      const cardId = pick(payload, [["card", "id"]]) as string | undefined;
      if (cardId) {
        await service
          .from("virtual_cards")
          .update({
            status: pick(payload, [["card", "status"]]) ?? "ACTIVE",
            masked_pan: pick(payload, [["card", "masked_pan"]]) ?? "",
            balance_usd: Number(pick(payload, [["card", "balance"]]) ?? 0),
            updated_at: new Date().toISOString(),
          })
          .eq("payvessel_card_id", cardId);
      }
      return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
    }

    if (payload?.event === "issuing.created.failed") {
      // No card_id in this payload per Payvessel's docs -- see the header
      // comment above. Logged for diagnosis; the affected row (if any) self
      // heals via payvessel-cards' "get" action next time the user checks.
      console.error("payvessel-webhook: card creation failed (cannot correlate to a row)", payload);
      return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
    }

    // --- virtual card: terminated (e.g. from Payvessel's own dashboard) ---
    if (payload?.event === "issuing.terminated") {
      const cardId = payload.card_id as string | undefined;
      if (cardId) {
        const { data: owned } = await service
          .from("virtual_cards")
          .select("id, user_id, status")
          .eq("payvessel_card_id", cardId)
          .maybeSingle();
        if (owned && owned.status !== "TERMINATED") {
          const remaining = Number(payload.amount ?? 0);
          if (remaining > 0) {
            const refundNgn = Math.round(remaining * RATE);
            const { data: userRow } = await service
              .from("users")
              .select("wallet_balance")
              .eq("id", owned.user_id)
              .single();
            await service
              .from("users")
              .update({ wallet_balance: Number(userRow?.wallet_balance ?? 0) + refundNgn })
              .eq("id", owned.user_id);
            await service.from("transactions").insert({
              user_id: owned.user_id,
              type: "card_terminate",
              amount: refundNgn,
              status: "successful",
              reference: (payload.reference as string) ?? `CARDTERM-${Date.now()}`,
              title: "Virtual card closed",
              subtitle: `Remaining $${remaining.toFixed(2)} refunded to wallet`,
            });
          }
          await service
            .from("virtual_cards")
            .update({ status: "TERMINATED", balance_usd: 0, updated_at: new Date().toISOString() })
            .eq("id", owned.id);
        }
      }
      return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
    }

    // --- virtual card: merchant spend / issuer fee events, logged only ---
    // (issuing.transaction / issuing.charge don't touch our NGN ledger --
    // that's the user's own USD spend on their own card.)
    if (payload?.event === "issuing.transaction" || payload?.event === "issuing.charge") {
      console.log("payvessel-webhook: card transaction", JSON.stringify(payload));
      return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
    }

    // --- card.transaction: contactless/cross-border fee recovery ---
    // Payvessel couldn't collect this fee from the card (insufficient
    // balance) and billed our business wallet instead -- recover it from
    // the card owner's NGN wallet. Per docs, `reference` is idempotent: the
    // same event is never charged twice, and a `status: "failed"` here
    // means Payvessel itself couldn't take the fee from OUR wallet and will
    // retry the same reference later.
    if (
      payload?.event === "card.transaction" &&
      (payload?.event_type === "contactless_fee" || payload?.event_type === "cross_border_fee")
    ) {
      const reference = payload.reference as string | undefined;
      const cardId = payload.card_id as string | undefined;
      const amountUsd = Number(payload.amount ?? 0);

      if (!reference || !cardId || !amountUsd || payload.status !== "successful") {
        console.log("payvessel-webhook: card fee event ignored (missing fields or not successful)", payload);
        return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
      }

      const { data: dupe } = await service.from("transactions").select("id").eq("reference", reference).maybeSingle();
      if (dupe) {
        return new Response(JSON.stringify({ status: "already processed" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data: owned } = await service
        .from("virtual_cards")
        .select("user_id, masked_pan")
        .eq("payvessel_card_id", cardId)
        .maybeSingle();

      if (owned) {
        const feeNgn = Math.round(amountUsd * RATE);
        const { data: userRow } = await service
          .from("users")
          .select("wallet_balance")
          .eq("id", owned.user_id)
          .single();
        await service
          .from("users")
          .update({ wallet_balance: Number(userRow?.wallet_balance ?? 0) - feeNgn })
          .eq("id", owned.user_id);
        await service.from("transactions").insert({
          user_id: owned.user_id,
          type: "card_fee",
          amount: feeNgn,
          status: "successful",
          reference,
          title: payload.event_type === "contactless_fee" ? "Contactless fee" : "Cross-border fee",
          subtitle: `Card •••• ${(owned.masked_pan as string)?.slice(-4) || ""}`,
        });
      }

      return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
    }

    // Anything else we don't recognize (or a future event whose real shape
    // hasn't been confirmed yet): nothing to credit, but still 200 so
    // Payvessel doesn't retry forever. Check the logged raw payload above
    // if something expected isn't being handled.
    return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
