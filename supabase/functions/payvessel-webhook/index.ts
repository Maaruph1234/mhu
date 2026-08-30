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
// Event used: `reserved_account.credit` (per
// docs.payvessel.com/api-reference/webhook/supported-events), fired when a
// customer transfer lands in a virtual account. Payvessel's docs don't
// publish a full example payload for this specific event (only a generic
// transaction.success shape), so the field paths below are read
// defensively across a few plausible shapes and the FULL raw payload is
// logged on every call -- check your function logs after your first real
// sandbox test transfer and tighten the field paths if something doesn't
// match.
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

    if (payload?.event !== "reserved_account.credit") {
      // Anything else: nothing to credit.
      return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
    }

    const amount = Number(
      pick(payload, [["data", "amount"], ["amount"], ["data", "transaction", "amount"]]) ?? 0
    );
    const reference =
      (pick(payload, [
        ["data", "reference"],
        ["reference"],
        ["data", "transaction", "reference"],
      ]) as string | undefined) ?? `PV-${Date.now()}`;
    const trackingReference = pick(payload, [
      ["data", "trackingReference"],
      ["data", "tracking_reference"],
      ["trackingReference"],
      ["data", "account", "trackingReference"],
    ]) as string | undefined;

    if (!trackingReference || !amount || amount <= 0) {
      console.error("payvessel-webhook: missing trackingReference or amount", payload);
      return new Response(JSON.stringify({ error: "Missing trackingReference or amount" }), { status: 400 });
    }

    const { data: account } = await service
      .from("payvessel_accounts")
      .select("user_id")
      .eq("tracking_reference", trackingReference)
      .maybeSingle();

    if (!account) {
      return new Response(JSON.stringify({ error: "Unknown virtual account" }), { status: 404 });
    }

    // Idempotency: skip if this reference has already been recorded.
    const { data: dupe } = await service
      .from("transactions")
      .select("id")
      .eq("reference", reference)
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

    const payerName = pick(payload, [
      ["data", "payer", "account_name"],
      ["data", "sender_name"],
    ]) as string | undefined;
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
