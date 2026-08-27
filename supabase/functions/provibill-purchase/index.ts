// Supabase Edge Function: provibill-purchase
// Deploy with: supabase functions deploy provibill-purchase
// Secrets required (set with `supabase secrets set ...`):
//   PROVIBILL_BASE_URL, PROVIBILL_USERNAME, PROVIBILL_PASSWORD, PROVIBILL_ACCOUNT_NO
// Optional (only if routing through a static-IP proxy for bank IP whitelisting):
//   PROVIBILL_PROXY_URL — e.g. http://USER:PASS@109.72.116.105:12323
//
// This function is the ONLY place Provibill credentials are used. Provibill
// (see the "Provibill Test Public" Postman collection) works as a
// multi-step flow rather than a single "pay" call like VTpass did:
//   1. GET  /categories                       — list bill categories
//   2. GET  /bill/assigned/byCategoryId/:id    — list billers in a category
//   3. GET  /field/assigned/byBillId/:id       — the input fields a bill needs
//   4. POST /validate/:billId/customer         — validate customer details
//   5. POST /makepayment                       — actually pay
//   6. GET  /makepayment/enquiry?txn_ref=...    — check a payment's status
//
// SECURITY NOTE: the Provibill base URL we were given is plain HTTP, not
// HTTPS (http://154.113.16.142:9999/provipay/webapi), and Basic Auth sends
// credentials in cleartext on every request. Confirm with Provibill
// whether there's an HTTPS endpoint before going live.
//
// IP WHITELISTING: ProvidusUnity Bank requires whitelisting the source IP
// that talks to their server, for up to 30 days at a time. Supabase Edge
// Functions do NOT run from a single fixed IP by default (shared, rotating
// pool), so real calls from this function will be rejected/time out unless
// PROVIBILL_PROXY_URL is set to a static-IP proxy. Use the "check-egress-ip"
// action below to confirm what IP Provibill will actually see before
// relying on this in production.
//
// PROVIBILL_ACCOUNT_NO: every Validate/Payment call needs a
// `customerAccountNo` and the bills need a `merchantFK` value. Per
// ProvidusUnity Bank (Aug 2026), this should be your own corporate
// settlement account number — for testing they issue separate test
// credentials. Confirm the real value with them; do not reuse the
// generic example value from their docs (1700415109) in production.
//
// ELECTRICITY PREPAID MAPPING: confirmed directly against the real
// "Get Bills by Category" response for category 4 (Electricity - Prepaid).
// Two important findings baked into ELECTRICITY_PREPAID_BILL_IDS below:
//   1. There are TWO Ikeja-related bills in that category — bill_id 7
//      ("Ikeja Electric - IKEDC", an older/legacy entry) and bill_id 1099
//      ("Ikeja Prepaid", the modern one we have confirmed field data for).
//      A naive name-match on "ikeja" would hit bill_id 7 first since it
//      appears earlier in the list — that's the wrong one. Hardcoding the
//      IDs below avoids this entirely.
//   2. Kano has NO modern ("Prepaid G") entry in this category — only the
//      legacy bill_id 19 ("Kano Electric - KEDCO"). Its field shape is
//      unconfirmed (we only have confirmed GetField data for bill_id 1099).
// Electricity Postpaid (category 5), Airtime, TV, Data and Exams still use
// live name-matching below because we don't have confirmed real bill lists
// for those yet — re-verify against live sandbox data before trusting them.

import { createClient } from "npm:@supabase/supabase-js@2";

const PROVIBILL_BASE_URL = Deno.env.get("PROVIBILL_BASE_URL") ?? "";
const PROVIBILL_USERNAME = Deno.env.get("PROVIBILL_USERNAME") ?? "";
const PROVIBILL_PASSWORD = Deno.env.get("PROVIBILL_PASSWORD") ?? "";
const PROVIBILL_ACCOUNT_NO = Deno.env.get("PROVIBILL_ACCOUNT_NO") ?? "";
const PROVIBILL_PROXY_URL = Deno.env.get("PROVIBILL_PROXY_URL") ?? "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Lazily built, reused across requests within the same function instance.
// If the Edge Runtime doesn't support Deno.createHttpClient's proxy option,
// this throws — callers catch it and surface a clear diagnostic instead of
// a confusing network error.
let _httpClient: Deno.HttpClient | undefined;
let _httpClientError: string | undefined;
function getHttpClient(): Deno.HttpClient | undefined {
  if (!PROVIBILL_PROXY_URL) return undefined;
  if (_httpClient) return _httpClient;
  if (_httpClientError) throw new Error(_httpClientError);
  try {
    // deno-lint-ignore no-explicit-any
    _httpClient = (Deno as any).createHttpClient({ proxy: { url: PROVIBILL_PROXY_URL } });
    return _httpClient;
  } catch (err) {
    _httpClientError = `Proxy client unsupported in this Edge Runtime: ${(err as Error).message}`;
    throw new Error(_httpClientError);
  }
}

function fetchOpts(extra: RequestInit = {}): RequestInit {
  const client = getHttpClient();
  // deno-lint-ignore no-explicit-any
  return client ? ({ ...extra, client } as any) : extra;
}

function provibillHeaders() {
  const basic = btoa(`${PROVIBILL_USERNAME}:${PROVIBILL_PASSWORD}`);
  return { Authorization: `Basic ${basic}`, "Content-Type": "application/json" };
}

async function pget(path: string) {
  const res = await fetch(`${PROVIBILL_BASE_URL}${path}`, fetchOpts({ headers: provibillHeaders() }));
  return res.json();
}

async function ppost(path: string, body: unknown) {
  const res = await fetch(
    `${PROVIBILL_BASE_URL}${path}`,
    fetchOpts({ method: "POST", headers: provibillHeaders(), body: JSON.stringify(body) })
  );
  return res.json();
}

// Category IDs confirmed from the real "Get Categories" response.
const CATEGORY_IDS: Record<string, number> = {
  airtime: 1,
  "tv-subscription": 2,
  data: 3,
  "electricity-prepaid": 4,
  "electricity-postpaid": 5,
  "exam-pin": 6,
};

// Confirmed directly against the real category-4 bill list (see header
// comment). Only covers discos this app actually offers (src/data/reference.ts).
const ELECTRICITY_PREPAID_BILL_IDS: Record<string, number> = {
  ikeja: 1099, // "Ikeja Prepaid" — confirmed GetField shape
  eko: 1088, // "Eko Prepaid"
  abuja: 1108, // "Abuja Prepaid"
  ph: 1101, // "Port Harcourt Prepaid"
  ibadan: 1103, // "Ibadan Prepaid"
  kano: 19, // no modern "Prepaid G" entry exists — legacy "Kano Electric - KEDCO", unconfirmed field shape
};

// Human-readable names to search for within a category's bill list, keyed
// by our internal service ids (network/disco/provider/exam body ids). Used
// as a fallback for anything not in a confirmed hardcoded map above (i.e.
// everything except electricity-prepaid right now). Only the electricity
// entries have been checked against real example data — re-verify Airtime,
// Data, TV and Exams once you can see real bill names in your sandbox.
const BILL_NAME_HINTS: Record<string, string> = {
  mtn: "mtn",
  airtel: "airtel",
  glo: "glo",
  "9mobile": "9mobile",
  ikeja: "ikeja",
  eko: "eko",
  abuja: "abuja",
  kano: "kano",
  ph: "port harcourt",
  ibadan: "ibadan",
  dstv: "dstv",
  gotv: "gotv",
  startimes: "startimes",
  waec: "waec",
  neco: "neco",
};

interface ProvibillBill {
  bill_id: number;
  name: string;
  description: string;
}

interface FieldDef {
  key: string;
  name: string;
  field_type: string;
  list?: { items: Array<{ id: string; name: string }>; list_type: string };
}

// Scores a candidate bill against a hint: exact name match scores highest,
// then "starts with", then plain substring — this avoids the class of bug
// where a short hint like "ikeja" matches an earlier, less-specific bill
// (e.g. a legacy entry) before the modern one further down the list.
function scoreMatch(name: string, hint: string): number {
  const n = name.toLowerCase().trim();
  const h = hint.toLowerCase().trim();
  if (n === h) return 3;
  if (n.startsWith(h)) return 2;
  if (n.includes(h)) return 1;
  return 0;
}

async function findBill(categoryId: number, serviceId: string): Promise<ProvibillBill> {
  const bills = (await pget(`/bill/assigned/byCategoryId/${categoryId}`)) as ProvibillBill[];
  const hint = BILL_NAME_HINTS[serviceId] ?? serviceId;
  let best: ProvibillBill | undefined;
  let bestScore = 0;
  for (const b of bills) {
    const score = Math.max(scoreMatch(b.name ?? "", hint), scoreMatch(b.description ?? "", hint));
    if (score > bestScore) {
      best = b;
      bestScore = score;
    }
  }
  if (!best) {
    throw new Error(`No Provibill bill found for "${serviceId}" in category ${categoryId}`);
  }
  return best;
}

async function resolveBillId(service: string, body: Record<string, unknown>): Promise<number> {
  if (service === "electricity") {
    const meterType = body.meterType === "postpaid" ? "postpaid" : "prepaid";
    const discoId = body.serviceId as string;
    if (meterType === "prepaid" && ELECTRICITY_PREPAID_BILL_IDS[discoId]) {
      return ELECTRICITY_PREPAID_BILL_IDS[discoId];
    }
    const categoryId = CATEGORY_IDS[meterType === "postpaid" ? "electricity-postpaid" : "electricity-prepaid"];
    const bill = await findBill(categoryId, discoId);
    return bill.bill_id;
  }
  const categoryId = CATEGORY_IDS[service];
  if (!categoryId) throw new Error(`Unknown service "${service}"`);
  const bill = await findBill(categoryId, body.serviceId as string);
  return bill.bill_id;
}

// Builds the `inputs` array Provibill's validate/pay endpoints expect, by
// matching our known values to fields by their human-readable `name`
// (case-insensitive substring match). For selection fields (biller/meter
// type/plan/bouquet — anything with a `list.items` array), it matches the
// plan's display name (variationLabel) against the item names, falling
// back to the only/first option when there's nothing to match against
// (this is correct and expected for single-item lists like Biller Name /
// Meter Type, which are effectively fixed per bill).
function buildInputs(fields: FieldDef[], values: Record<string, string | number | undefined>) {
  const inputs: Array<{ key: string; value: string }> = [];
  for (const field of fields) {
    const name = field.name.toLowerCase();
    let value: string | undefined;

    if (name.includes("meter") && name.includes("number")) value = values.meterNumber as string;
    else if (name.includes("smartcard") || name.includes("iuc")) value = values.smartcardNumber as string;
    else if (name.includes("phone")) value = values.phone as string;
    else if (name.includes("customer") && name.includes("name")) value = values.customerName as string;
    else if (name.includes("amount")) value = String(values.amount ?? "");
    else if (name.includes("quantity")) value = String(values.quantity ?? "1");
    else if (field.list?.items?.length) {
      const wanted = (values.variationLabel as string)?.toLowerCase();
      const found =
        (wanted && field.list.items.find((i) => i.name.toLowerCase().includes(wanted))) ??
        field.list.items[0];
      value = found?.id;
    }

    if (value !== undefined) inputs.push({ key: field.key, value: String(value) });
  }
  return inputs;
}

Deno.serve(async (req) => {
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
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const body = await req.json();

    // --- diagnostic: what IP does Provibill actually see from us? ---
    // Call with { "action": "check-egress-ip" }. Useful for confirming a
    // proxy's real exit IP before giving it to the bank for whitelisting.
    if (body.action === "check-egress-ip") {
      try {
        const res = await fetch("https://api.ipify.org?format=json", fetchOpts());
        const json = await res.json();
        return new Response(
          JSON.stringify({
            egressIp: json.ip,
            proxied: Boolean(PROVIBILL_PROXY_URL),
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: (err as Error).message, proxied: Boolean(PROVIBILL_PROXY_URL) }),
          { status: 500 }
        );
      }
    }

    const service = body.service as string;
    const billId = await resolveBillId(service, body);
    const fieldData = (await pget(`/field/assigned/byBillId/${billId}`)) as { fields: FieldDef[] };

    const inputs = buildInputs(fieldData.fields, {
      meterNumber: body.meterNumber,
      smartcardNumber: body.smartcardNumber,
      phone: body.phone,
      customerName: body.customerName,
      amount: body.amount,
      quantity: body.quantity,
      variationLabel: body.variationLabel ?? body.variationCode,
    });

    const channelRef = `MHU-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const requestBody = {
      inputs,
      billId: String(billId),
      customerAccountNo: PROVIBILL_ACCOUNT_NO,
      channel_ref: channelRef,
    };

    // --- verification calls (no debit) ---
    if (body.action === "validate") {
      const json = await ppost(`/validate/${billId}/customer`, requestBody);
      return new Response(
        JSON.stringify({ customerName: json?.customer_name ?? "Unknown", raw: json }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // --- payment inquiry (status check, no debit) ---
    if (body.action === "inquiry") {
      const json = await pget(`/makepayment/enquiry?txn_ref=${encodeURIComponent(body.reference)}`);
      return new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } });
    }

    // --- purchase (debit wallet, then call Provibill) ---
    const amount = Number(body.amount ?? 0);
    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount" }), { status: 400 });
    }

    // There's no separate `wallets` table in the real schema — balance is
    // just `users.wallet_balance`.
    const { data: userRow } = await supabase
      .from("users")
      .select("wallet_balance")
      .eq("id", user.id)
      .single();

    if (!userRow || Number(userRow.wallet_balance ?? 0) < amount) {
      return new Response(JSON.stringify({ error: "Insufficient wallet balance" }), { status: 402 });
    }

    const payJson = await ppost(`/makepayment`, requestBody);
    const success = payJson?.responseCode === "00" || payJson?.message === "Request successful";

    if (success) {
      await supabase
        .from("users")
        .update({ wallet_balance: Number(userRow.wallet_balance ?? 0) - amount })
        .eq("id", user.id);
    }

    await supabase.from("transactions").insert({
      user_id: user.id,
      type: service.replace(/-/g, "_"),
      amount,
      status: success ? "successful" : "failed",
      reference: channelRef,
      title: `${service} purchase via Provibill`,
    });

    return new Response(
      JSON.stringify({
        success,
        reference: channelRef,
        message: payJson?.responseMessage ?? (success ? "Purchase successful" : "Purchase failed"),
        raw: payJson,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
