// Supabase Edge Function: payvessel-esim
// Deploy with: supabase functions deploy payvessel-esim
//
// eSIM data package purchasing via Payvessel's VaaS eSIM API. Endpoints and
// schemas confirmed directly against docs.payvessel.com/api-reference/esim/*
// -- not guessed. Base path is /vaas/api/v1/esim (different prefix from the
// card-issuing and identity-verification APIs, which each have their own).
//
// Secrets required: PAYVESSEL_API_KEY, PAYVESSEL_SECRET, PAYVESSEL_BASE_URL
// (same three already used everywhere else). No NGN<->USD rate needed here
// -- Payvessel's package list already returns `price_naira` directly, so we
// charge that value (with no conversion guesswork) rather than reusing the
// manually-maintained rate from payvessel-cards.
//
// The order lives in `esim_orders` (see supabase/schema.sql), fetched by
// user_id only -- payvessel-esim has no business-wide "list all orders"
// endpoint the way cards/flights do, but the isolation habit is kept
// anyway: a user can only ever "get" an order_id this function already
// recorded as theirs.

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
// Fallback only -- used just in case a package is missing price_naira (the
// schema marks it nullable), converting price_usd at the same manually
// maintained rate used for virtual cards.
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

    if (action === "regions") {
      const { ok, json: res } = await pvGet("/vaas/api/v1/esim/regions");
      if (!ok || !res?.status) return json({ error: res?.message ?? "Could not load regions" }, { status: 502 });
      return json({ regions: res.data ?? [] });
    }

    if (action === "packages") {
      const params = new URLSearchParams();
      if (body.locationCode) params.set("location_code", body.locationCode);
      const { ok, json: res } = await pvGet(`/vaas/api/v1/esim/packages?${params.toString()}`);
      if (!ok || !res?.status) return json({ error: res?.message ?? "Could not load packages" }, { status: 502 });
      return json({ packages: res.data ?? [] });
    }

    if (action === "list") {
      const { data, error } = await service
        .from("esim_orders")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ orders: data ?? [] });
    }

    if (action === "get") {
      const orderId = body.orderId as string;
      const { data: owned } = await service
        .from("esim_orders")
        .select("*")
        .eq("user_id", user.id)
        .eq("payvessel_order_id", orderId)
        .maybeSingle();
      if (!owned) return json({ error: "Order not found" }, { status: 404 });

      const { ok, json: res } = await pvGet(`/vaas/api/v1/esim/orders/${orderId}`);
      if (!ok || !res?.status) return json({ error: res?.message ?? "Could not load order" }, { status: 502 });

      const profile = (res.data.profiles as Record<string, unknown>[] | undefined)?.[0];
      await service
        .from("esim_orders")
        .update({
          status: res.data.status,
          qr_code_url: profile?.qr_code_url ?? owned.qr_code_url,
          iccid: profile?.iccid ?? owned.iccid,
          activation_details: profile ?? owned.activation_details,
          updated_at: new Date().toISOString(),
        })
        .eq("id", owned.id);

      return json({ order: res.data });
    }

    if (action === "create") {
      const packageCode = body.packageCode as string;
      if (!packageCode) return json({ error: "packageCode is required" }, { status: 400 });

      // Look the package up ourselves rather than trusting a client-sent
      // price -- this is what's actually charged, and it must come from
      // Payvessel, not from whatever the client last rendered.
      const { ok: pkgOk, json: pkgRes } = await pvGet(
        `/vaas/api/v1/esim/packages?package_code=${encodeURIComponent(packageCode)}`
      );
      const pkg = pkgOk && pkgRes?.status ? (pkgRes.data ?? [])[0] : null;
      if (!pkg) {
        return json({ error: "That eSIM package is no longer available" }, { status: 404 });
      }

      const amountNgn = Math.round(Number(pkg.price_naira ?? Number(pkg.price_usd) * RATE));

      const { data: userRow } = await service
        .from("users")
        .select("wallet_balance")
        .eq("id", user.id)
        .single();
      if (!userRow || Number(userRow.wallet_balance ?? 0) < amountNgn) {
        return json({ error: "Insufficient wallet balance" }, { status: 402 });
      }

      const reference = `ESIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { ok, json: orderRes } = await pvPost("/vaas/api/v1/esim/orders", {
        reference,
        package_code: packageCode,
      });
      if (!ok || !orderRes?.status) {
        return json({ error: orderRes?.message ?? "Could not create eSIM order" }, { status: 502 });
      }

      const order = orderRes.data;

      await service
        .from("users")
        .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - amountNgn })
        .eq("id", user.id);

      const { data: saved, error: saveError } = await service
        .from("esim_orders")
        .insert({
          user_id: user.id,
          payvessel_order_id: order.id,
          reference,
          package_code: packageCode,
          package_name: pkg.name,
          location: pkg.location,
          amount_ngn: amountNgn,
          status: order.status,
        })
        .select()
        .single();
      if (saveError) return json({ error: saveError.message }, { status: 500 });

      await service.from("transactions").insert({
        user_id: user.id,
        type: "esim_purchase",
        amount: amountNgn,
        status: "successful",
        reference,
        title: "eSIM data package",
        subtitle: `${pkg.name} (${pkg.location})`,
      });

      return json({ order: saved });
    }

    return json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
