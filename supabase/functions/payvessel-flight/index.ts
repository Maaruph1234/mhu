// Supabase Edge Function: payvessel-flight
// Deploy with: supabase functions deploy payvessel-flight
//
// Flight search + booking via Payvessel's VaaS Flight API. Endpoints and
// schemas confirmed directly against docs.payvessel.com/api-reference/
// flight/* -- not guessed. Base path is /vaas/api/v1/flight.
//
// Secrets required: PAYVESSEL_API_KEY, PAYVESSEL_SECRET, PAYVESSEL_BASE_URL
// (same three already used everywhere else), reusing PAYVESSEL_USD_NGN_RATE
// from payvessel-cards for the (likely) case pricing comes back in USD.
//
// ============================================================================
// WHY THERE'S A QUOTES TABLE
// ============================================================================
// Search results carry only "preview" pricing tied to an opaque
// selection_token. Creating a quote locks in the real, final price and a
// quote_id/expiry -- but Payvessel has no separate "get quote" endpoint, so
// the only place that final price is ever visible is the create-quote
// response itself. flight_quotes persists it right there so create-order
// can charge the user the SAME number Payvessel already validated, instead
// of re-deriving or (worse) trusting whatever the client sends back later.
// It also records which user created the quote, so completing an order
// against a quote_id always re-checks `user_id = auth.uid()` first -- the
// same isolation habit as virtual_cards, since Payvessel's own order data
// is business-wide, not per-customer.

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
const RATE = Number(Deno.env.get("PAYVESSEL_USD_NGN_RATE")) || 1500;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const pvHeaders = {
  "api-key": PAYVESSEL_API_KEY,
  "api-secret": PAYVESSEL_SECRET,
  "Content-Type": "application/json",
};

async function pvGet(path: string) {
  const res = await fetch(`${PAYVESSEL_BASE_URL}${path}`, { headers: pvHeaders });
  return { ok: res.ok, json: await res.json() };
}

async function pvPost(path: string, body: unknown) {
  const res = await fetch(`${PAYVESSEL_BASE_URL}${path}`, {
    method: "POST",
    headers: pvHeaders,
    body: JSON.stringify(body),
  });
  return { ok: res.ok, json: await res.json() };
}

function toNgn(amount: number, currencyCode: string): number {
  return currencyCode === "NGN" ? Math.round(amount) : Math.round(amount * RATE);
}

function routeSummary(journeys: Record<string, unknown>[] | undefined): string {
  if (!journeys?.length) return "Flight";
  return journeys
    .map((j) => `${j.departure_airport_code ?? "?"}→${j.arrival_airport_code ?? "?"}`)
    .join(" / ");
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

    if (action === "airports") {
      const { ok, json: res } = await pvGet("/vaas/api/v1/flight/airports");
      if (!ok || !res?.status) return json({ error: res?.message ?? "Could not load airports" }, { status: 502 });
      return json({ airports: res.data ?? [] });
    }

    if (action === "search") {
      const { ok, json: res } = await pvPost("/vaas/api/v1/flight/search", {
        search_type: body.searchType ?? "oneway",
        cabin_class: body.cabinClass ?? "economy",
        adults: body.adults ?? 1,
        children: body.children ?? 0,
        infants: body.infants ?? 0,
        itineraries: body.itineraries,
      });
      if (!ok || !res?.status) return json({ error: res?.message ?? "Flight search failed" }, { status: 502 });
      return json({ options: res.data ?? [] });
    }

    if (action === "quote") {
      const selectionToken = body.selectionToken as string;
      if (!selectionToken) return json({ error: "selectionToken is required" }, { status: 400 });

      const { ok, json: res } = await pvPost("/vaas/api/v1/flight/quotes", { selection_token: selectionToken });
      if (!ok || !res?.status) return json({ error: res?.message ?? "Could not create quote" }, { status: 502 });

      const quote = res.data;
      const summary = routeSummary(quote.journeys);

      const { error: saveError } = await service.from("flight_quotes").insert({
        user_id: user.id,
        payvessel_quote_id: quote.id,
        currency_code: quote.pricing.currency_code,
        total_amount: quote.pricing.total_amount,
        route_summary: summary,
        status: quote.status,
        expires_at: quote.expires_at,
      });
      if (saveError) return json({ error: saveError.message }, { status: 500 });

      return json({
        quote: {
          id: quote.id,
          airlineName: quote.airline_name,
          airlineLogoUrl: quote.airline_logo_url,
          journeys: quote.journeys,
          pricing: quote.pricing,
          expiresAt: quote.expires_at,
          amountNgn: toNgn(quote.pricing.total_amount, quote.pricing.currency_code),
        },
      });
    }

    if (action === "createOrder") {
      const quoteId = body.quoteId as string;
      const passengers = body.passengers as unknown[];
      if (!quoteId || !passengers?.length) {
        return json({ error: "quoteId and at least one passenger are required" }, { status: 400 });
      }

      const { data: quoteRow } = await service
        .from("flight_quotes")
        .select("*")
        .eq("user_id", user.id)
        .eq("payvessel_quote_id", quoteId)
        .maybeSingle();

      if (!quoteRow) {
        return json({ error: "Quote not found" }, { status: 404 });
      }
      if (quoteRow.status !== "active" || new Date(quoteRow.expires_at) < new Date()) {
        return json({ error: "This quote has expired. Please search again." }, { status: 400 });
      }

      const amountNgn = toNgn(Number(quoteRow.total_amount), quoteRow.currency_code);

      const { data: userRow } = await service
        .from("users")
        .select("wallet_balance")
        .eq("id", user.id)
        .single();
      if (!userRow || Number(userRow.wallet_balance ?? 0) < amountNgn) {
        return json({ error: "Insufficient wallet balance" }, { status: 402 });
      }

      const reference = `FLT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { ok, json: orderRes } = await pvPost("/vaas/api/v1/flight/orders", {
        quote_id: quoteId,
        reference,
        passenger_details: passengers,
      });
      if (!ok || !orderRes?.status) {
        return json({ error: orderRes?.message ?? "Could not create flight order" }, { status: 502 });
      }

      const order = orderRes.data;

      await service
        .from("users")
        .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - amountNgn })
        .eq("id", user.id);

      await service.from("flight_quotes").update({ status: "consumed" }).eq("id", quoteRow.id);

      const { data: saved, error: saveError } = await service
        .from("flight_orders")
        .insert({
          user_id: user.id,
          payvessel_order_id: order.id,
          merchant_reference: order.merchant_reference ?? reference,
          route_summary: quoteRow.route_summary,
          amount_ngn: amountNgn,
          status: order.status,
          passengers,
        })
        .select()
        .single();
      if (saveError) return json({ error: saveError.message }, { status: 500 });

      await service.from("transactions").insert({
        user_id: user.id,
        type: "flight_booking",
        amount: amountNgn,
        status: "successful",
        reference,
        title: "Flight booking",
        subtitle: quoteRow.route_summary,
      });

      return json({ order: saved });
    }

    if (action === "list") {
      const { data, error } = await service
        .from("flight_orders")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ orders: data ?? [] });
    }

    if (action === "get") {
      const orderId = body.orderId as string;
      const { data: owned } = await service
        .from("flight_orders")
        .select("*")
        .eq("user_id", user.id)
        .eq("payvessel_order_id", orderId)
        .maybeSingle();
      if (!owned) return json({ error: "Order not found" }, { status: 404 });

      const { ok, json: res } = await pvGet(`/vaas/api/v1/flight/orders/${orderId}`);
      if (!ok || !res?.status) return json({ error: res?.message ?? "Could not load order" }, { status: 502 });

      await service
        .from("flight_orders")
        .update({ status: res.data.status, updated_at: new Date().toISOString() })
        .eq("id", owned.id);

      return json({ order: res.data });
    }

    return json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
