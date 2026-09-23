// Shared login/token helper for the xpresswallet-* edge functions.
//
// Xpress Wallet's auth model (see developer.providusbank.com/xpress-wallet-api,
// the authoritative Providus Bank docs -- confirmed live, not guessed) is
// different from every other provider in this codebase: instead of a
// single static secret sent as a header, you POST /auth/login with a
// merchant email+password and get back a pair of short-lived tokens --
// X-Access-Token / X-Refresh-Token -- as RESPONSE HEADERS, not in the JSON
// body. Every other endpoint then needs both of those headers on every
// request. A handful of sensitive endpoints (customer/merchant bank
// transfers, wallet-to-wallet transfers, merchant wallet/profile) ALSO
// require a merchant "private key" (from the Xpress Wallet dashboard's
// Access Keys page, sk_sandbox_xxx / sk_live_xxx) as a Bearer token on top
// of those two headers.
//
// Secrets required (set with `supabase secrets set ...`):
//   XPRESSWALLET_BASE_URL       (defaults to https://payment.xpress-wallet.com/api/v1)
//   XPRESSWALLET_EMAIL          merchant dashboard login email
//   XPRESSWALLET_PASSWORD       merchant dashboard login password
//   XPRESSWALLET_PRIVATE_KEY    sk_sandbox_xxx / sk_live_xxx, only needed
//                                for endpoints that send withPrivateKey:true
//                                below (bank transfers, merchant wallet)
//
// CORRECTED Sept 2026: the base URL published on developer.providusbank.com
// (https://api.xpresswallet.com) turned out to be a dead/parked domain
// (confirmed by the user -- it's a GoDaddy "domain for sale" page). The
// real host is https://payment.xpress-wallet.com, confirmed from two
// independent sources: (1) the user's own Providus/Xpress Wallet docs
// screenshot showing "Public URL: https://payment.xpress-wallet.com" and
// "Base URL: https://payment.xpress-wallet.com/api/v1/wallet" for the
// wallet-creation endpoint, and (2) the actively-maintained third-party
// Laravel SDK (atanunu/laravel-xpresswallet)'s published config default,
// 'base_url' => env('XPRESSWALLET_BASE_URL', 'https://payment.xpress-wallet.com').
// Reconciling both: the shared root is .../api/v1, and each endpoint's path
// (below) is appended to that -- e.g. POST {base}/wallet is exactly the
// "https://payment.xpress-wallet.com/api/v1/wallet" the docs screenshot
// showed for wallet creation.
//
// NOTE on login body encoding: the same third-party SDK's docs state it
// takes raw credentials and "auto base64"-encodes them before the login
// call, which corroborates the public docs' example body (which showed
// base64'd email/password). Flipped ENCODE_CREDENTIALS to true on this
// evidence. If login now fails with a credentials/format error, flip it
// back to false and redeploy.
const ENCODE_CREDENTIALS = true;

const BASE_URL = Deno.env.get("XPRESSWALLET_BASE_URL") || "https://payment.xpress-wallet.com/api/v1";
const EMAIL = Deno.env.get("XPRESSWALLET_EMAIL") ?? "";
const PASSWORD = Deno.env.get("XPRESSWALLET_PASSWORD") ?? "";
const PRIVATE_KEY = Deno.env.get("XPRESSWALLET_PRIVATE_KEY") ?? "";

export const XW_BASE_URL = BASE_URL;

export interface XwTokens {
  accessToken: string;
  refreshToken: string;
}

function b64(s: string): string {
  return btoa(s);
}

/** Logs in and returns a fresh access/refresh token pair. Called once per
 * request (edge functions are short-lived, so there's no warm-instance
 * token cache here -- simplicity over the small latency saving). */
export async function xwLogin(): Promise<XwTokens> {
  if (!EMAIL || !PASSWORD) {
    throw new Error("XPRESSWALLET_EMAIL / XPRESSWALLET_PASSWORD are not set");
  }
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ENCODE_CREDENTIALS ? b64(EMAIL) : EMAIL,
      password: ENCODE_CREDENTIALS ? b64(PASSWORD) : PASSWORD,
    }),
  });

  const accessToken = res.headers.get("X-Access-Token") ?? res.headers.get("x-access-token");
  const refreshToken = res.headers.get("X-Refresh-Token") ?? res.headers.get("x-refresh-token");
  const body = await res.json().catch(() => ({}));

  if (!res.ok || !accessToken || !refreshToken) {
    throw new Error(body?.message ?? `Xpress Wallet login failed (HTTP ${res.status})`);
  }

  return { accessToken, refreshToken };
}

/** Builds the header set for an authenticated Xpress Wallet request. Pass
 * withPrivateKey: true for the endpoints that additionally require the
 * merchant's Bearer secret (see the module comment above). */
export function xwAuthHeaders(tokens: XwTokens, opts: { withPrivateKey?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Access-Token": tokens.accessToken,
    "X-Refresh-Token": tokens.refreshToken,
  };
  if (opts.withPrivateKey) {
    if (!PRIVATE_KEY) {
      throw new Error("XPRESSWALLET_PRIVATE_KEY is not set (required for this endpoint)");
    }
    headers["Authorization"] = `Bearer ${PRIVATE_KEY}`;
  }
  return headers;
}
