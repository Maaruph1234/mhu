// Supabase Edge Function: vtpass-balance-alert
// Deploy with: supabase functions deploy vtpass-balance-alert
//
// Checks this business's own VTpass prepaid wallet balance (GET /balance,
// confirmed against vtpass.com/documentation/get-vtpass-wallet-balance --
// response shape: { code: 1, contents: { balance: number } }) and, if it's
// below VTPASS_LOW_BALANCE_THRESHOLD, emails an alert via Resend -- the
// same RESEND_API_KEY/RESEND_FROM_EMAIL already used by send-signup-otp,
// no new email infra needed.
//
// Why this exists: vtpass-purchase only protects the CUSTOMER (their
// wallet_balance is never debited unless VTpass confirms success) -- but
// nothing previously told the business when VTpass's own account was
// running low, so purchases would just start silently failing with no
// warning. This closes that gap.
//
// Not triggered by customer traffic -- meant to be invoked on a schedule
// (see the pg_cron + pg_net SQL given alongside this file). Safe to call
// as often as you like: a cooldown (ALERT_COOLDOWN_HOURS) stops it from
// emailing every single run while the balance stays low -- it only
// re-alerts once the cooldown has passed, or immediately if the balance
// drops further still below the threshold since the last alert.
//
// Secrets required (set with `supabase secrets set ...`):
//   VTPASS_API_KEY, VTPASS_PUBLIC_KEY, VTPASS_BASE_URL -- already set for
//     vtpass-purchase, reused as-is here.
//   RESEND_API_KEY, RESEND_FROM_EMAIL -- already set for send-signup-otp,
//     reused as-is here.
//   VTPASS_LOW_BALANCE_THRESHOLD -- naira amount, e.g. "10000". Defaults to
//     10000 if unset.
//   VTPASS_ALERT_EMAIL_TO -- where the alert goes. Defaults to
//     ryoshisdogshib01@gmail.com if unset.

import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const VTPASS_BASE_URL = Deno.env.get("VTPASS_BASE_URL") ?? "https://sandbox.vtpass.com/api";
const VTPASS_API_KEY = Deno.env.get("VTPASS_API_KEY") ?? "";
const VTPASS_PUBLIC_KEY = Deno.env.get("VTPASS_PUBLIC_KEY") ?? "";

// Same proxy pattern as vtpass-purchase -- VTpass's LIVE API requires a
// fixed whitelisted outbound IP, which Supabase Edge Functions don't have
// on their own. Falls back to unproxied (fine for sandbox) if unset.
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

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "";
const ALERT_EMAIL_TO = Deno.env.get("VTPASS_ALERT_EMAIL_TO") ?? "ryoshisdogshib01@gmail.com";
const LOW_BALANCE_THRESHOLD = Number(Deno.env.get("VTPASS_LOW_BALANCE_THRESHOLD") ?? "10000");
const ALERT_COOLDOWN_HOURS = Number(Deno.env.get("VTPASS_ALERT_COOLDOWN_HOURS") ?? "12");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function getVtpassBalance(): Promise<number> {
  const res = await fetch(`${VTPASS_BASE_URL}/balance`, {
    headers: { "api-key": VTPASS_API_KEY, "public-key": VTPASS_PUBLIC_KEY },
    client: proxyClient,
  });
  const data = await res.json();
  const balance = Number(data?.contents?.balance);
  if (Number.isNaN(balance)) {
    throw new Error(`Unexpected /balance response: ${JSON.stringify(data)}`);
  }
  return balance;
}

async function sendAlertEmail(balance: number) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    console.error("vtpass-balance-alert: RESEND_API_KEY/RESEND_FROM_EMAIL not set, cannot send alert email");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: ALERT_EMAIL_TO,
      subject: `⚠️ VTpass wallet balance is low: ₦${balance.toLocaleString()}`,
      html:
        `<p>Your VTpass prepaid wallet balance is <strong>₦${balance.toLocaleString()}</strong>, ` +
        `below your configured alert threshold of ₦${LOW_BALANCE_THRESHOLD.toLocaleString()}.</p>` +
        `<p>Customers trying to buy data/airtime/TV bundles larger than this balance will start getting ` +
        `"Purchase failed" errors -- their wallet is never charged when that happens, but you'll lose the sale ` +
        `and the customer sees a failure.</p>` +
        `<p>Top up your VTpass account to keep purchases going through.</p>`,
    }),
  });
  if (!res.ok) {
    console.error("vtpass-balance-alert: Resend error", await res.text());
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const balance = await getVtpassBalance();

    if (balance >= LOW_BALANCE_THRESHOLD) {
      return json({ balance, threshold: LOW_BALANCE_THRESHOLD, alerted: false, reason: "balance ok" });
    }

    // Single-row cooldown table (see vtpass_balance_alert_schema.sql) --
    // re-alert only after ALERT_COOLDOWN_HOURS have passed, OR immediately
    // if the balance has dropped further since the last alert (worth
    // knowing about even mid-cooldown).
    const { data: state } = await supabase
      .from("vtpass_balance_alert_state")
      .select("last_alerted_at, last_balance")
      .eq("id", true)
      .maybeSingle();

    const hoursSinceLastAlert = state?.last_alerted_at
      ? (Date.now() - new Date(state.last_alerted_at).getTime()) / 36e5
      : Infinity;
    const droppedFurther = state?.last_balance != null && balance < Number(state.last_balance);

    if (hoursSinceLastAlert < ALERT_COOLDOWN_HOURS && !droppedFurther) {
      return json({ balance, threshold: LOW_BALANCE_THRESHOLD, alerted: false, reason: "cooldown active" });
    }

    await sendAlertEmail(balance);
    await supabase
      .from("vtpass_balance_alert_state")
      .upsert({ id: true, last_alerted_at: new Date().toISOString(), last_balance: balance });

    return json({ balance, threshold: LOW_BALANCE_THRESHOLD, alerted: true });
  } catch (err) {
    console.error("vtpass-balance-alert: error", err);
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
