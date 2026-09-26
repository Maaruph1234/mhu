// Supabase Edge Function: hadjibs-purchase
// Deploy with: supabase functions deploy hadjibs-purchase
// Secret required (set with `supabase secrets set ...`):
//   HADJIBS_API_KEY
//
// Hadjibs Data (hadjibsdata.com.ng) is the mobile-network subscriber
// provider (airtime + data) as of Oct 2026, replacing VTpass for those two
// products specifically. VTpass is still used for everything Hadjibs
// doesn't offer via API -- Cable TV, Electricity, Exam Pins (see
// vtpass-purchase) -- Hadjibs' own dashboard has those too, but its public
// API (hadjibsdata.com.ng/mobile/home/api-docs, read directly from the
// account's own logged-in Developer > API Access page) only documents
// three endpoints:
//
//   GET  /api/user   {apikey}                                 -> balance check
//   POST /api/data    {apikey, network, plan, phone}           -> buy data
//   POST /api/airtime {apikey, network, amount, phone}         -> buy airtime
//
// Auth is a single key -- no secret/public key split like VTpass, and no
// signature/HMAC. Their docs show it as a plain `apikey` body param, but
// real behavior (confirmed by hitting the live endpoint directly, and by a
// real logged purchase attempt) doesn't match the docs on three points:
//   1. The URL needs a TRAILING SLASH -- POST /api/airtime (no slash)
//      doesn't reach the working handler (their server appears to redirect
//      it, which silently downgrades the method, producing a nonsensical
//      "Only POST method is allowed" error from what was actually a GET).
//      POST /api/airtime/ (with the slash) reaches the real handler.
//   2. Sending `apikey` as a body param (or query param) is NOT enough --
//      the API replies "Your authorization token is required." even with a
//      trailing-slash URL and a body apikey. Their own wording ("token")
//      points at header-based auth, so the key is also sent as an
//      `Authorization` header (in addition to keeping `apikey` in the body,
//      harmless either way).
//   3. The Authorization header must be the RAW KEY, with NO "Bearer "
//      prefix. A real failed purchase came back with
//      {"status":"fail","msg":"Authorization token not found Bearer <key>"}
//      -- their server echoes back the exact header value it received and
//      says it wasn't found, meaning it compares the raw header value
//      against a stored key rather than stripping a "Bearer " prefix first.
//      So "Authorization: Bearer <key>" fails; "Authorization: <key>" is
//      what their server actually expects.
//
// `network` must be exactly "MTN" | "GLO" | "AIRTEL" | "9MOBILE" (their
// docs example use uppercase). `plan` is a numeric Plan Id -- Hadjibs' own
// docs example oddly shows `plan=500MB` (a display name, not an id), but
// their Pricing page (More > Pricing, logged in) lists real integer Plan
// Ids per network/bundle (e.g. MTN 500MB 7-day SME = 217) and that's what a
// reseller API actually keys off; the full live catalog is transcribed into
// src/data/hadjibsDataPlans.ts. Re-confirm this against a real test
// purchase too.
//
// NOT SUPPORTED: Hadjibs has no requery/status-check endpoint in its public
// API -- once /api/data or /api/airtime responds, that response (plus our
// own generated reference for record-keeping) is the only signal we ever
// get. A network timeout on our end leaves the transaction's true outcome
// unknown with no way to look it up later; it's recorded as "failed" here
// (see catch block) since no debit happened on our side, but the purchase
// may or may not have gone through at Hadjibs regardless.
//
// CORS: this function is called directly from the browser (via
// supabase.functions.invoke), so it must answer the browser's CORS
// preflight (OPTIONS) request and send Access-Control-Allow-* headers on
// every response -- without that, the browser silently blocks the request
// and the client just sees "Failed to send a request to the Edge Function".

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

const HADJIBS_BASE_URL = Deno.env.get("HADJIBS_BASE_URL") ?? "https://hadjibsdata.com.ng/api";
const HADJIBS_API_KEY = Deno.env.get("HADJIBS_API_KEY") ?? "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function hadjibsPost(path: string, params: Record<string, string | number>) {
  const body = new URLSearchParams({ apikey: HADJIBS_API_KEY, ...Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ) });
  // Trailing slash required -- see header comment. path is passed WITHOUT
  // one (e.g. "/airtime") so it reads naturally at call sites; added here.
  const res = await fetch(`${HADJIBS_BASE_URL}${path}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Confirmed via a real failed purchase's logged response:
      // {"status":"fail","msg":"Authorization token not found Bearer <key>"}
      // -- their server echoes back the exact header value it received and
      // says it wasn't found, which means it's comparing the RAW header
      // value against a stored key rather than stripping a "Bearer " prefix
      // first. So the prefix itself is the bug: send the key alone.
      "Authorization": HADJIBS_API_KEY,
    },
    body,
  });
  return res.json();
}

// Networks Hadjibs' own docs list for both airtime and data.
const NETWORK_IDS: Record<string, string> = {
  mtn: "MTN",
  glo: "GLO",
  airtel: "AIRTEL",
  "9mobile": "9MOBILE",
};

function generateReference(): string {
  return `MHU-HDJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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
    const service = body.service as string; // "airtime" | "data"

    if (service !== "airtime" && service !== "data") {
      return json({ error: `"${service}" is not available via Hadjibs Data` }, { status: 400 });
    }

    const network = NETWORK_IDS[body.serviceId];
    if (!network) {
      return json({ error: `"${body.serviceId}" is not a supported network` }, { status: 400 });
    }
    if (service === "data" && network === "9MOBILE") {
      // Confirmed against Hadjibs' own live Pricing page: the Data Plan
      // table has rows for MTN/AIRTEL/GLO only, no 9MOBILE bundles at all
      // (despite 9MOBILE being a documented valid network value generally).
      return json({ error: "9mobile data bundles are not available via Hadjibs Data yet" }, { status: 400 });
    }

    const amount = Number(body.amount ?? 0);
    if (!amount || amount <= 0) {
      return json({ error: "Invalid amount" }, { status: 400 });
    }
    const phone = body.phone as string;
    if (!phone) {
      return json({ error: "Phone number is required" }, { status: 400 });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("wallet_balance")
      .eq("id", user.id)
      .single();

    if (!userRow || Number(userRow.wallet_balance ?? 0) < amount) {
      return json({ error: "Insufficient wallet balance" }, { status: 402 });
    }

    const reference = generateReference();

    let hadjibsJson: Record<string, unknown>;
    if (service === "airtime") {
      hadjibsJson = await hadjibsPost("/airtime", { network, amount, phone });
    } else {
      // variationCode carries Hadjibs' numeric Plan Id (see
      // src/data/hadjibsDataPlans.ts) -- required for /api/data.
      const plan = body.variationCode as string;
      if (!plan) {
        return json({ error: "Missing data plan" }, { status: 400 });
      }
      hadjibsJson = await hadjibsPost("/data", { network, plan, phone });
    }

    console.log("hadjibs-purchase: outgoing request", service, network, phone);
    console.log("hadjibs-purchase: raw Hadjibs response", JSON.stringify(hadjibsJson));

    const success = hadjibsJson?.status === "success";

    if (success) {
      await supabase
        .from("users")
        .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - amount })
        .eq("id", user.id);
    }

    // A `notify_on_transaction` trigger on the `transactions` table builds a
    // notification body as `subtitle || ' - ' || sign || amount` -- if
    // subtitle is null, the whole concatenation is null, which violates a
    // NOT NULL constraint on notifications.body and silently rolls back the
    // entire insert. Every insert below must set a real subtitle.
    const { error: txnError } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: service,
      amount,
      status: success ? "successful" : "failed",
      reference,
      // Never mention the backend processor's name here -- it's an
      // implementation detail, not something the customer should see in
      // their own transaction history (matches every other edge function's
      // titles, none of which leak "via Hadjibs"/"via VTpass").
      title: service === "airtime" ? "Airtime purchase" : "Data purchase",
      subtitle: `To ${phone}`,
    });
    if (txnError) {
      console.error("Failed to insert transaction record:", txnError);
    }

    return json({
      success,
      reference,
      message:
        (hadjibsJson?.message as string | undefined) ?? (success ? "Purchase successful" : "Purchase failed"),
      raw: hadjibsJson,
      txnLogError: txnError?.message,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
