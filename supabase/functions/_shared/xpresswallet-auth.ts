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
//   XPRESSWALLET_BASE_URL       (defaults to https://api.xpresswallet.com)
//   XPRESSWALLET_EMAIL          merchant dashboard login email
//   XPRESSWALLET_PASSWORD       merchant dashboard login password
//   XPRESSWALLET_PRIVATE_KEY    sk_sandbox_xxx / sk_live_xxx, only needed
//                                for endpoints that send withPrivateKey:true
//                                below (bank transfers, merchant wallet)
//
// NOTE on login body encoding: the public docs' example request body shows
// email/password as base64 strings (e.g. "password" -> "cGFzc3dvcmQ=").
// It's unclear whether that's a real API requirement or just Postman's own
// masking of example credentials in public docs -- the docs don't say
// either way. This sends plaintext by default. If login fails against the
// real sandbox with a credentials/format error, flip ENCODE_CREDENTIALS to
// true below and redeploy.
const ENCODE_CREDENTIALS = false;

const BASE_URL = Deno.env.get("XPRESSWALLET_BASE_URL") || "https://api.xpresswallet.com";
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
