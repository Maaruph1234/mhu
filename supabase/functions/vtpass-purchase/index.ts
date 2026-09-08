// Supabase Edge Function: vtpass-purchase
// Deploy with: supabase functions deploy vtpass-purchase
// Secrets required (set with `supabase secrets set ...`):
//   VTPASS_API_KEY, VTPASS_SECRET_KEY, VTPASS_PUBLIC_KEY
//   VTPASS_BASE_URL=https://sandbox.vtpass.com/api  (switch to
//   https://vtpass.com/api once provisioned for live)
//
// Every endpoint/field/response shape here is confirmed directly against
// VTpass's own documentation (vtpass.com/documentation), not guessed:
//   - Auth: GET requests use api-key + public-key headers; POST requests
//     use api-key + secret-key headers.
//   - GET  /service-variations?serviceID=X   -> { content: { variations } }
//   - POST /merchant-verify {billersCode, serviceID, type}  -> verification
//   - POST /pay {request_id, serviceID, amount, phone, billersCode?,
//     variation_code?, quantity?}  -> { code, response_description, content }
//   - POST /requery {request_id}  -> same shape as /pay
//
// SANDBOX TEST VALUES (only work against the sandbox base URL):
//   Airtime/data success: phone 08011111111 (any other number simulates a
//   failure; specific numbers simulate pending/timeout/no-response — see
//   VTpass docs if you need those scenarios).
//   Electricity success: meterNumber 1111111111111 (prepaid) or
//   1010101010101 (postpaid); any other number simulates a failed
//   verification/purchase.
//   TV subscription success (DSTV/GOTV/StarTimes — all three use the SAME
//   value, distinct from electricity's): smartcardNumber 1212121212.
//
// NOT SUPPORTED: VTpass does not offer a NECO result-checker product (only
// WAEC Registration/Result Checker and JAMB). The exam-pin UI still shows
// NECO as an option (see src/data/reference.ts) — purchases for it will
// return a clear error below rather than silently hitting the wrong
// product. Remove it from the UI, or find an alternate provider, before
// going live.
//
// CORS: this function is called directly from the browser (via
// supabase.functions.invoke), so it must answer the browser's CORS
// preflight (OPTIONS) request and send Access-Control-Allow-* headers on
// every response — without that, the browser silently blocks the request
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

const VTPASS_BASE_URL = Deno.env.get("VTPASS_BASE_URL") ?? "https://sandbox.vtpass.com/api";
const VTPASS_API_KEY = Deno.env.get("VTPASS_API_KEY") ?? "";
const VTPASS_SECRET_KEY = Deno.env.get("VTPASS_SECRET_KEY") ?? "";
const VTPASS_PUBLIC_KEY = Deno.env.get("VTPASS_PUBLIC_KEY") ?? "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// VTpass's LIVE API rejects calls with "IP NOT WHITELISTED, CONTACT
// SUPPORT" (code 027) unless they come from a fixed IP -- but Supabase
// Edge Functions run on Deno Deploy's globally distributed infra with no
// static outbound IP of their own (confirmed against Supabase's own docs:
// "Why Supabase Edge Functions cannot provide static egress IPs for
// whitelisting"). So every VTpass call here is routed through a dedicated
// proxy with one fixed IP instead, and THAT IP is what's whitelisted with
// VTpass. Credentials are read from secrets, never hardcoded, exactly like
// PAYVESSEL_API_KEY etc. -- set with:
//   supabase secrets set VTPASS_PROXY_HOST=... VTPASS_PROXY_PORT=...
//   supabase secrets set VTPASS_PROXY_USERNAME=... VTPASS_PROXY_PASSWORD=...
// If any of these aren't set, calls fall back to going out directly
// (unproxied) -- fine for sandbox, but live calls will keep failing with
// error 027 until all four are set.
const VTPASS_PROXY_HOST = Deno.env.get("VTPASS_PROXY_HOST") ?? "";
const VTPASS_PROXY_PORT = Deno.env.get("VTPASS_PROXY_PORT") ?? "";
const VTPASS_PROXY_USERNAME = Deno.env.get("VTPASS_PROXY_USERNAME") ?? "";
const VTPASS_PROXY_PASSWORD = Deno.env.get("VTPASS_PROXY_PASSWORD") ?? "";

const proxyClient =
  VTPASS_PROXY_HOST && VTPASS_PROXY_PORT && VTPASS_PROXY_USERNAME && VTPASS_PROXY_PASSWORD
    ? Deno.createHttpClient({
        proxy: {
          url: `http://${VTPASS_PROXY_USERNAME}:${VTPASS_PROXY_PASSWORD}@${VTPASS_PROXY_HOST}:${VTPASS_PROXY_PORT}`,
        },
      })
    : undefined;

async function vget(path: string) {
  const res = await fetch(`${VTPASS_BASE_URL}${path}`, {
    headers: { "api-key": VTPASS_API_KEY, "public-key": VTPASS_PUBLIC_KEY },
    client: proxyClient,
  });
  return res.json();
}

async function vpost(path: string, body: unknown) {
  const res = await fetch(`${VTPASS_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "api-key": VTPASS_API_KEY,
      "secret-key": VTPASS_SECRET_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    client: proxyClient,
  });
  return res.json();
}

// Request IDs must be >=12 chars, start with today's date+hour+minute in
// Africa/Lagos time (GMT+1), per VTpass's spec.
function generateRequestId(): string {
  const lagos = new Date(Date.now() + 60 * 60 * 1000); // UTC+1, no DST in Nigeria
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    lagos.getUTCFullYear().toString() +
    pad(lagos.getUTCMonth() + 1) +
    pad(lagos.getUTCDate()) +
    pad(lagos.getUTCHours()) +
    pad(lagos.getUTCMinutes());
  return `${stamp}${Math.random().toString(36).slice(2, 10)}`;
}

// Service IDs confirmed against VTpass's own documentation for each
// product page (not guessed) — note portharcourt-electric/abuja-electric
// etc. all follow a "{cityname}-electric" pattern, NOT the disco
// abbreviation (e.g. it's "portharcourt-electric", not "phed-electric").
// Same pattern confirmed for the 6 discos added later: aba-electric,
// benin-electric, enugu-electric, jos-electric, kaduna-electric,
// yola-electric — each verified against its own vtpass.com/documentation
// page rather than assumed from the pattern alone.
const AIRTIME_IDS: Record<string, string> = {
  mtn: "mtn",
  airtel: "airtel",
  glo: "glo",
  "9mobile": "etisalat",
};

const DATA_IDS: Record<string, string> = {
  mtn: "mtn-data",
  airtel: "airtel-data",
  glo: "glo-data",
  "9mobile": "etisalat-data",
};

const TV_IDS: Record<string, string> = {
  dstv: "dstv",
  gotv: "gotv",
  startimes: "startimes",
};

const ELECTRICITY_IDS: Record<string, string> = {
  ikeja: "ikeja-electric",
  eko: "eko-electric",
  abuja: "abuja-electric",
  kano: "kano-electric",
  ph: "portharcourt-electric",
  ibadan: "ibadan-electric",
  aba: "aba-electric",
  benin: "benin-electric",
  enugu: "enugu-electric",
  jos: "jos-electric",
  kaduna: "kaduna-electric",
  yola: "yola-electric",
};

const EXAM_IDS: Record<string, string> = {
  waec: "waec",
  // "neco" intentionally omitted — see header comment, not a real VTpass product.
};

const EXAM_VARIATION_CODES: Record<string, string> = {
  waec: "waecdirect",
};

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
    const service = body.service as string;

    const resolveServiceId = (): string => {
      if (service === "airtime") return AIRTIME_IDS[body.serviceId];
      if (service === "data") return DATA_IDS[body.serviceId];
      if (service === "tv-subscription") return TV_IDS[body.serviceId];
      if (service === "electricity") return ELECTRICITY_IDS[body.serviceId];
      if (service === "exam-pin") return EXAM_IDS[body.serviceId];
      return "";
    };

    const serviceID = resolveServiceId();
    if (!serviceID) {
      return json({ error: `"${body.serviceId}" is not available for ${service} via VTpass` }, { status: 400 });
    }

    // --- meter/smartcard verification (no debit) ---
    if (body.action === "verify") {
      if (service === "electricity") {
        const verifyJson = await vpost("/merchant-verify", {
          billersCode: body.meterNumber,
          serviceID,
          type: body.meterType ?? "prepaid",
        });
        return json({
          customerName: verifyJson?.content?.Customer_Name ?? verifyJson?.content?.Name ?? "Unknown",
          address: verifyJson?.content?.Address,
          raw: verifyJson,
        });
      }
      if (service === "tv-subscription") {
        const verifyJson = await vpost("/merchant-verify", {
          billersCode: body.smartcardNumber,
          serviceID,
        });
        return json({
          customerName: verifyJson?.content?.Customer_Name ?? "Unknown",
          dueDate: verifyJson?.content?.Due_Date ?? verifyJson?.content?.DueDate,
          raw: verifyJson,
        });
      }
      return json({ error: "Verification not supported for this service" }, { status: 400 });
    }

    // --- variation codes (data plans / tv bouquets, no debit) ---
    // Confirmed against developers.vtpass.com/documentation/variation-codes --
    // this is the endpoint the file header always claimed was wired up, but
    // it wasn't actually called anywhere until now: Data.tsx/Tv.tsx were
    // sending made-up placeholder codes (e.g. "dstv-padi") instead of
    // VTpass's real ones, which VTpass would reject as invalid.
    if (body.action === "variations") {
      const variationsJson = await vget(`/service-variations?serviceID=${serviceID}`);
      const variations = (variationsJson?.content?.variations ?? []).map(
        (v: { variation_code: string; name: string; variation_amount: string }) => ({
          code: v.variation_code,
          name: v.name,
          price: Number(v.variation_amount),
        })
      );
      return json({ variations });
    }

    // --- payment inquiry (status check, no debit) ---
    if (body.action === "inquiry") {
      const inquiryJson = await vpost("/requery", { request_id: body.reference });
      return json(inquiryJson);
    }

    // --- purchase (debit wallet, then call VTpass) ---
    const amount = Number(body.amount ?? 0);
    if (!amount || amount <= 0) {
      return json({ error: "Invalid amount" }, { status: 400 });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("wallet_balance")
      .eq("id", user.id)
      .single();

    if (!userRow || Number(userRow.wallet_balance ?? 0) < amount) {
      return json({ error: "Insufficient wallet balance" }, { status: 402 });
    }

    const requestId = generateRequestId();
    const payBody: Record<string, unknown> = {
      request_id: requestId,
      serviceID,
      amount,
      phone: body.phone ?? "08011111111",
    };

    if (service === "data") {
      payBody.billersCode = body.phone;
      payBody.variation_code = body.variationCode;
    } else if (service === "tv-subscription") {
      payBody.billersCode = body.smartcardNumber;
      payBody.variation_code = body.variationCode;
      // "renew" is only valid when the customer is renewing their EXISTING
      // bouquet at a Renewal_Amount obtained from a prior merchant-verify
      // call. Our UI always lets the customer freely pick any bouquet with
      // no tracked prior subscription, which is VTpass's "change" (new
      // purchase / bouquet change) case -- sending "renew" here caused
      // purchases to fail. DSTV and GOtv require this field; StarTimes'
      // documented payload doesn't include it at all, so it's only sent for
      // the providers that need it.
      if (body.serviceId === "dstv" || body.serviceId === "gotv") {
        payBody.subscription_type = "change";
      }
    } else if (service === "electricity") {
      payBody.billersCode = body.meterNumber;
      payBody.variation_code = body.meterType ?? "prepaid";
    } else if (service === "exam-pin") {
      payBody.variation_code = EXAM_VARIATION_CODES[body.serviceId];
      payBody.quantity = body.quantity ?? 1;
    }
    // airtime needs nothing beyond serviceID/amount/phone, already set above.

    // A `notify_on_transaction` trigger on the `transactions` table builds a
    // notification body as `subtitle || ' - ' || sign || amount` -- if
    // subtitle is null, the whole concatenation is null, which violates a
    // NOT NULL constraint on notifications.body and silently rolls back the
    // entire insert. Every insert below must set a real subtitle.
    const subtitle =
      service === "electricity"
        ? `Meter ${body.meterNumber}`
        : service === "tv-subscription"
        ? `Smartcard ${body.smartcardNumber}`
        : service === "exam-pin"
        ? `${body.quantity ?? 1} pin(s)`
        : `To ${body.phone ?? "recipient"}`;

    // Logged so the raw VTpass response is retrievable from Supabase's
    // function logs -- needed to see the REAL failure reason when it
    // doesn't come back in the normal { code, response_description,
    // content } shape (e.g. a live-account auth/IP-whitelist rejection),
    // which otherwise silently falls through to the generic "Purchase
    // failed" message below.
    console.log("vtpass-purchase: outgoing /pay request", JSON.stringify(payBody));
    const payJson = await vpost("/pay", payBody);
    console.log("vtpass-purchase: raw VTpass response", JSON.stringify(payJson));
    const success = payJson?.code === "000" && payJson?.content?.transactions?.status === "delivered";

    if (success) {
      await supabase
        .from("users")
        .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - amount })
        .eq("id", user.id);
    }

    const { error: txnError } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: service.replace(/-/g, "_"),
      amount,
      status: success ? "successful" : "failed",
      reference: requestId,
      title: `${service.replace(/-/g, " ")} purchase via VTpass`,
      subtitle,
    });
    // The purchase itself already happened (or failed) at VTpass regardless
    // of whether this local record-keeping insert works -- but a failure
    // here was previously silent. Log it loudly (visible via
    // `supabase functions logs vtpass-purchase`) so it's actually caught.
    if (txnError) {
      console.error("Failed to insert transaction record:", txnError);
    }

    return json({
      success,
      reference: requestId,
      message: payJson?.response_description ?? (success ? "Purchase successful" : "Purchase failed"),
      raw: payJson,
      txnLogError: txnError?.message,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});



