// Supabase Edge Function: payvessel-cards
// Deploy with: supabase functions deploy payvessel-cards
//
// Virtual USD card issuing (create/list/get/fund/withdraw/freeze/unfreeze/
// terminate/transactions) via Payvessel's Issuing API. Endpoints, request
// fields, and response shapes confirmed directly against
// docs.payvessel.com/virtual-cards/overview and
// docs.payvessel.com/api-reference/virtual-cards/* -- not guessed.
//
// Secrets required: PAYVESSEL_API_KEY, PAYVESSEL_SECRET, PAYVESSEL_BASE_URL
// (same three already used by the other payvessel-* functions), plus:
//   PAYVESSEL_USD_NGN_RATE (optional) -- see RATE below.
//
// ============================================================================
// WHY THIS FUNCTION EXISTS AS A GATEKEEPER, NOT A THIN PROXY
// ============================================================================
// Payvessel issues cards under ONE shared business account for all of MHU
// Global. Its "Get all Cards" endpoint returns EVERY card ever issued to
// EVERY user, business-wide -- there is no per-customer scoping on their
// side. If any client code called that endpoint directly, one user could
// see another user's card. So this function never forwards that endpoint's
// raw response to a client. Instead, `virtual_cards` (see
// supabase/schema.sql) is our own per-user index: every action here first
// resolves/checks `payvessel_card_id` against a row owned by the caller
// (`user_id = auth.uid()`), and "list" reads that table instead of ever
// calling Payvessel's list endpoint at all.
//
// ============================================================================
// MONEY FLOW: two separate ledgers
// ============================================================================
// 1. The user's MHU wallet (`users.wallet_balance`) is in NGN.
// 2. Payvessel's card system runs on a single BUSINESS USD wallet, shared
//    across all cards for all users (funded by whoever manages the
//    Payvessel account, via their dashboard/bank transfer -- not by this
//    code). Funding/withdrawing a customer's card debits/credits that
//    shared business USD wallet, not the individual user.
// This function is the bridge: every USD amount a user funds onto or
// withdraws from their own card is converted at RATE and mirrored as an
// NGN debit/credit on THEIR OWN wallet_balance, so each user only ever
// spends/receives their own money even though Payvessel's ledger doesn't
// know about individual users at all.
//
// RATE is a manually-maintained NGN-per-USD number, NOT a live FX feed --
// there's no exchange-rate API wired in. Set PAYVESSEL_USD_NGN_RATE as a
// secret and keep it current (check e.g. xe.com or the CBN rate
// periodically); the fallback below is a rough Aug-2026 snapshot
// (official ~1342, black-market ~1410) plus a margin, and WILL drift out of
// date on its own. Whoever manages this account should treat that fallback
// as "better than crashing," not as a rate to actually charge on.
//
// ============================================================================
// KYC image handling
// ============================================================================
// `image` is Payvessel's required base64 identity-document photo. It is
// forwarded to Payvessel as-is and never stored in our own database --
// only the resulting card metadata is persisted.

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
// See RATE comment block above -- manually maintained, not live FX.
const RATE = Number(Deno.env.get("PAYVESSEL_USD_NGN_RATE")) || 1500;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ACTIVE_CARDS_PER_USER = 3;

const pvHeaders = {
  "api-key": PAYVESSEL_API_KEY,
  "api-secret": PAYVESSEL_SECRET,
  "Content-Type": "application/json",
};

async function pvGet(path: string) {
  const res = await fetch(`${PAYVESSEL_BASE_URL}${path}`, { headers: pvHeaders });
  return { ok: res.ok, json: await res.json() };
}

async function pvPost(path: string, body?: unknown) {
  const res = await fetch(`${PAYVESSEL_BASE_URL}${path}`, {
    method: "POST",
    headers: pvHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, json: await res.json() };
}

// Only fields safe to hand back to the client. card_number/cvv are stripped
// unless the caller explicitly asked to reveal them for an active viewing
// session (see "get" action) -- matches Payvessel's own security guidance
// (docs.payvessel.com/virtual-cards/overview#security-best-practices).
function publicCard(card: Record<string, unknown>, reveal = false) {
  const { card_number, cvv, ...safe } = card;
  return reveal ? { ...safe, card_number, cvv } : safe;
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
    const action = body.action as string;

    // --- list: our own table only, never Payvessel's business-wide list ---
    if (action === "list") {
      const { data, error } = await service
        .from("virtual_cards")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ cards: data ?? [] });
    }

    // Every other action operates on one specific card -- resolve and
    // verify ownership up front so no action below can touch someone
    // else's card_id.
    if (action !== "create") {
      const cardId = body.cardId as string;
      if (!cardId) return json({ error: "cardId is required" }, { status: 400 });

      const { data: owned } = await service
        .from("virtual_cards")
        .select("*")
        .eq("user_id", user.id)
        .eq("payvessel_card_id", cardId)
        .maybeSingle();

      if (!owned) {
        return json({ error: "Card not found" }, { status: 404 });
      }

      if (action === "get") {
        const { ok, json: cardJson } = await pvGet(`/pms/api/external/request/virtual-cards/${cardId}/`);
        if (!ok || !cardJson?.status) {
          return json({ error: cardJson?.message ?? "Could not load card" }, { status: 502 });
        }
        const live = cardJson.data;
        await service
          .from("virtual_cards")
          .update({
            status: live.status,
            masked_pan: live.masked_pan || owned.masked_pan,
            balance_usd: Number(live.balance ?? owned.balance_usd),
            updated_at: new Date().toISOString(),
          })
          .eq("id", owned.id);
        return json({ card: publicCard(live, body.reveal === true) });
      }

      if (action === "fund" || action === "withdraw") {
        const amount = Number(body.amountUsd ?? 0);
        const minimum = action === "fund" ? 1 : 3;
        if (!amount || amount < minimum) {
          return json({ error: `Minimum ${action} amount is $${minimum.toFixed(2)}` }, { status: 400 });
        }
        if (owned.status !== "ACTIVE") {
          return json({ error: `Card is ${owned.status.toLowerCase()}, not active` }, { status: 400 });
        }

        const ngnAmount = Math.round(amount * RATE);

        if (action === "fund") {
          const { data: userRow } = await service
            .from("users")
            .select("wallet_balance")
            .eq("id", user.id)
            .single();
          if (!userRow || Number(userRow.wallet_balance ?? 0) < ngnAmount) {
            return json({ error: "Insufficient wallet balance" }, { status: 402 });
          }

          const { ok, json: fundJson } = await pvPost(
            `/pms/api/external/request/virtual-cards/${cardId}/fund/`,
            { amount: amount.toFixed(2) }
          );
          if (!ok || !fundJson?.status) {
            return json({ error: fundJson?.message ?? "Could not fund card" }, { status: 502 });
          }

          await service
            .from("users")
            .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - ngnAmount })
            .eq("id", user.id);

          await service
            .from("virtual_cards")
            .update({ balance_usd: Number(fundJson.data?.balance ?? owned.balance_usd + amount), updated_at: new Date().toISOString() })
            .eq("id", owned.id);

          await service.from("transactions").insert({
            user_id: user.id,
            type: "card_fund",
            amount: ngnAmount,
            status: "successful",
            reference: `CARDFUND-${Date.now()}`,
            title: "Virtual card funded",
            subtitle: `$${amount.toFixed(2)} to card •••• ${owned.masked_pan.slice(-4) || ""}`,
          });

          return json({ success: true, card: publicCard(fundJson.data) });
        }

        // withdraw: moves USD from the card back to the shared business
        // wallet, so we credit the user's own NGN wallet in return.
        const { ok, json: withdrawJson } = await pvPost(
          `/pms/api/external/request/virtual-cards/${cardId}/withdraw/`,
          { amount: amount.toFixed(2) }
        );
        if (!ok || !withdrawJson?.status) {
          return json({ error: withdrawJson?.message ?? "Could not withdraw from card" }, { status: 502 });
        }

        const { data: userRow } = await service
          .from("users")
          .select("wallet_balance")
          .eq("id", user.id)
          .single();

        await service
          .from("users")
          .update({ wallet_balance: Number(userRow?.wallet_balance ?? 0) + ngnAmount })
          .eq("id", user.id);

        await service
          .from("virtual_cards")
          .update({ balance_usd: Number(withdrawJson.data?.balance ?? Math.max(0, owned.balance_usd - amount)), updated_at: new Date().toISOString() })
          .eq("id", owned.id);

        await service.from("transactions").insert({
          user_id: user.id,
          type: "card_withdraw",
          amount: ngnAmount,
          status: "successful",
          reference: `CARDWD-${Date.now()}`,
          title: "Virtual card withdrawal",
          subtitle: `$${amount.toFixed(2)} from card •••• ${owned.masked_pan.slice(-4) || ""}`,
        });

        return json({ success: true, card: publicCard(withdrawJson.data) });
      }

      if (action === "freeze" || action === "unfreeze") {
        const { ok, json: res } = await pvPost(
          `/pms/api/external/request/virtual-cards/${cardId}/${action}/`
        );
        if (!ok || !res?.status) {
          return json({ error: res?.message ?? `Could not ${action} card` }, { status: 502 });
        }
        await service
          .from("virtual_cards")
          .update({ status: res.data?.status ?? (action === "freeze" ? "FROZEN" : "ACTIVE"), updated_at: new Date().toISOString() })
          .eq("id", owned.id);
        return json({ success: true, card: publicCard(res.data) });
      }

      if (action === "terminate") {
        // Fetch the live balance first so we know how much to refund --
        // our cached balance_usd could be stale.
        const { json: liveJson } = await pvGet(`/pms/api/external/request/virtual-cards/${cardId}/`);
        const preBalance = Number(liveJson?.data?.balance ?? owned.balance_usd ?? 0);

        const { ok, json: termJson } = await pvPost(
          `/pms/api/external/request/virtual-cards/${cardId}/terminate/`
        );
        if (!ok || !termJson?.status) {
          return json({ error: termJson?.message ?? "Could not terminate card" }, { status: 502 });
        }

        if (preBalance > 0) {
          const refundNgn = Math.round(preBalance * RATE);
          const { data: userRow } = await service
            .from("users")
            .select("wallet_balance")
            .eq("id", user.id)
            .single();
          await service
            .from("users")
            .update({ wallet_balance: Number(userRow?.wallet_balance ?? 0) + refundNgn })
            .eq("id", user.id);
          await service.from("transactions").insert({
            user_id: user.id,
            type: "card_terminate",
            amount: refundNgn,
            status: "successful",
            reference: `CARDTERM-${Date.now()}`,
            title: "Virtual card closed",
            subtitle: `Remaining $${preBalance.toFixed(2)} refunded to wallet`,
          });
        }

        await service
          .from("virtual_cards")
          .update({ status: "TERMINATED", balance_usd: 0, updated_at: new Date().toISOString() })
          .eq("id", owned.id);

        return json({ success: true });
      }

      if (action === "transactions") {
        const size = Math.min(Number(body.size ?? 50) || 50, 100);
        const { ok, json: txJson } = await pvGet(
          `/pms/api/external/request/virtual-cards/${cardId}/transactions/?size=${size}`
        );
        if (!ok || !txJson?.status) {
          return json({ error: txJson?.message ?? "Could not load card transactions" }, { status: 502 });
        }
        return json({ transactions: txJson.data ?? [] });
      }

      return json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // --- create ---
    const {
      firstName,
      lastName,
      email,
      phone,
      bvn,
      nin,
      dob,
      image,
      state,
      lga,
      street,
      postalCode,
      brand,
      cardName,
      isContactless,
      prefundAmountUsd,
    } = body;

    const required = { firstName, lastName, email, phone, bvn, nin, dob, image, state, lga, street, postalCode, brand };
    const missing = Object.entries(required)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      return json({ error: `Missing required field(s): ${missing.join(", ")}` }, { status: 400 });
    }
    if (!["VISA", "MASTERCARD"].includes(brand)) {
      return json({ error: "brand must be VISA or MASTERCARD" }, { status: 400 });
    }

    const { count } = await service
      .from("virtual_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .neq("status", "TERMINATED");
    if ((count ?? 0) >= MAX_ACTIVE_CARDS_PER_USER) {
      return json({ error: `You can hold at most ${MAX_ACTIVE_CARDS_PER_USER} cards at a time` }, { status: 400 });
    }

    let prefund = 0;
    let ngnCost = 0;
    if (prefundAmountUsd !== undefined && prefundAmountUsd !== null && Number(prefundAmountUsd) > 0) {
      prefund = Number(prefundAmountUsd);
      if (prefund < 1) {
        return json({ error: "Minimum initial funding is $1.00" }, { status: 400 });
      }
      ngnCost = Math.round(prefund * RATE);
      const { data: userRow } = await service
        .from("users")
        .select("wallet_balance")
        .eq("id", user.id)
        .single();
      if (!userRow || Number(userRow.wallet_balance ?? 0) < ngnCost) {
        return json({ error: "Insufficient wallet balance for the initial funding amount" }, { status: 402 });
      }
    }

    const { ok, json: createJson } = await pvPost("/pms/api/external/request/virtual-cards/", {
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      bvn,
      nin,
      dob,
      image,
      state,
      lga,
      street,
      postal_code: postalCode,
      brand,
      currency: "USD",
      is_contactless: isContactless === true,
      ...(prefund > 0 ? { prefund_amount: prefund.toFixed(2) } : {}),
      ...(cardName ? { card_name: cardName } : {}),
    });

    if (!ok || !createJson?.status) {
      return json({ error: createJson?.message ?? "Could not create card" }, { status: 502 });
    }

    const issued = createJson.data;

    // Prefund is applied synchronously by Payvessel as part of this same
    // create call (the response already reflects it in `balance`), so it's
    // safe to debit the user's NGN wallet now that we know it succeeded.
    if (ngnCost > 0) {
      const { data: userRow } = await service
        .from("users")
        .select("wallet_balance")
        .eq("id", user.id)
        .single();
      await service
        .from("users")
        .update({ wallet_balance: Number(userRow?.wallet_balance ?? 0) - ngnCost })
        .eq("id", user.id);
      await service.from("transactions").insert({
        user_id: user.id,
        type: "card_create",
        amount: ngnCost,
        status: "successful",
        reference: `CARDNEW-${Date.now()}`,
        title: "Virtual card created",
        subtitle: `${brand} card funded with $${prefund.toFixed(2)}`,
      });
    }

    const { data: inserted, error: insertError } = await service
      .from("virtual_cards")
      .insert({
        user_id: user.id,
        payvessel_card_id: issued.id,
        brand: issued.brand ?? brand,
        currency: "USD",
        card_name: cardName ?? `${firstName} ${lastName}`,
        masked_pan: issued.masked_pan ?? "",
        status: issued.status ?? "PENDING",
        balance_usd: Number(issued.balance ?? prefund),
      })
      .select()
      .single();

    if (insertError) {
      return json({ error: insertError.message }, { status: 500 });
    }

    return json({ card: inserted });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
