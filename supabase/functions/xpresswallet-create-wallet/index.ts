// Supabase Edge Function: xpresswallet-create-wallet
// Deploy with: supabase functions deploy xpresswallet-create-wallet
//
// Secrets required (set with `supabase secrets set ...`):
//   XPRESSWALLET_BASE_URL, XPRESSWALLET_EMAIL, XPRESSWALLET_PASSWORD
//   (see _shared/xpresswallet-auth.ts for what each does)
//
// Creates a Customer + Wallet on Xpress Wallet (Providus Bank) for the
// authenticated user via POST /wallet, then stores the returned dedicated
// account (a REAL Providus Bank account number, not a pass-through virtual
// account -- see the "Create Customer Wallet" page at
// developer.providusbank.com/xpress-wallet-api/merchant/wallet/create-customer-wallet)
// in the `xpresswallet_accounts` table so FundWallet.tsx can display it.
//
// This is the ACTIVE wallet-funding integration (switched back from
// Korapay, Sept 2026 -- see .env.example and README.md).
//
// CORS: called directly from the browser (FundWallet.tsx), so it needs to
// answer the browser's preflight OPTIONS request and echo CORS headers on
// every response -- without these, supabase-js's invoke() fails before the
// function's own logic ever runs, surfaced to the user as a generic
// "Failed to send a request to the Edge Function".

import { createClient } from "npm:@supabase/supabase-js@2";
import { xwLogin, xwAuthHeaders, XW_BASE_URL } from "../_shared/xpresswallet-auth.ts";

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Finds an already-existing Xpress Wallet customer + wallet for this user and
// returns it in the same shape POST /wallet responds with, so the caller can
// treat it like a fresh creation. Pages through ALL customers (the by-phone
// lookup proved unreliable) and only links on a SAFE match, so nobody can
// claim someone else's wallet just by typing their BVN or phone:
//   - same email (verified by our signup OTP), OR
//   - same phone AND same BVN together.
// Returns null if nothing matches in the CURRENT mode (live and sandbox are
// separate).
async function findExistingWallet(
  tokens: Awaited<ReturnType<typeof xwLogin>>,
  phone: string,
  email: string,
  bvn: string
) {
  const last10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
  const myPhone = last10(phone);
  const myEmail = email.trim().toLowerCase();

  let customer: Record<string, any> | undefined;
  for (let page = 1; page <= 50 && !customer; page++) {
    const r = await fetch(`${XW_BASE_URL}/customer?page=${page}`, { headers: xwAuthHeaders(tokens) });
    const j = await r.json().catch(() => ({}));
    const list: Array<Record<string, any>> = Array.isArray(j?.customers) ? j.customers : [];
    console.log(
      "xpresswallet-create-wallet: customer list",
      JSON.stringify({
        page,
        http: r.status,
        keys: Object.keys(j ?? {}),
        message: j?.message,
        count: list.length,
        meta: j?.metadata,
        // masked sample so we can see the real field formats without leaking data
        sample: list.slice(0, 5).map((c) => ({
          email: String(c.email ?? "").replace(/^(.{2}).*(@.*)$/, "$1***$2"),
          phone: String(c.phoneNumber ?? "").slice(0, 4) + "***" + String(c.phoneNumber ?? "").slice(-3),
          bvnLen: String(c.bvn ?? "").length,
        })),
        looking: { email: myEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2"), phoneLast10: myPhone.slice(0, 3) + "***" + myPhone.slice(-3) },
      })
    );
    customer = list.find(
      (c) =>
        (myEmail && String(c.email ?? "").trim().toLowerCase() === myEmail) ||
        (last10(c.phoneNumber) === myPhone && String(c.bvn ?? "") === bvn)
    );
    const totalPages = Number(j?.metadata?.totalPages ?? 1);
    if (!r.ok || list.length === 0 || page >= totalPages) break;
  }
  if (!customer?.id) {
    console.error("xpresswallet-create-wallet: no safe match among existing customers");
    return null;
  }

  let wallet: Record<string, unknown> | undefined;
  for (let page = 1; page <= 50 && !wallet; page++) {
    const r = await fetch(`${XW_BASE_URL}/wallet?page=${page}`, { headers: xwAuthHeaders(tokens) });
    const j = await r.json().catch(() => ({}));
    const list: Array<Record<string, unknown>> = Array.isArray(j?.wallets) ? j.wallets : [];
    wallet = list.find((w) => w.id === customer!.walletId || w.walletId === customer!.id);
    const totalPages = Number(j?.metadata?.totalPages ?? 1);
    if (!r.ok || list.length === 0 || page >= totalPages) break;
  }
  if (!wallet?.accountNumber) {
    console.error("xpresswallet-create-wallet: matched customer but found no wallet", customer.id);
    return null;
  }

  return { status: true, customer: { id: customer.id, tier: customer.tier }, wallet };
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

    const { bvn, dateOfBirth, address } = await req.json();
    if (!bvn || bvn.length !== 11) {
      return json({ error: "A valid 11-digit BVN is required" }, { status: 400 });
    }
    if (!dateOfBirth || !address) {
      return json({ error: "dateOfBirth and address are required" }, { status: 400 });
    }

    // Already has an account? Return it instead of creating a duplicate.
    const { data: existing } = await service
      .from("xpresswallet_accounts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      return json(existing);
    }

    const { data: profile } = await service
      .from("users")
      .select("display_name, email, phone_number")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return json({ error: "Profile not found" }, { status: 404 });
    }
    if (!profile.phone_number || !profile.email) {
      return json(
        { error: "Your profile needs a phone number and email on file before you can fund your wallet" },
        { status: 400 }
      );
    }

    const [firstName, ...rest] = (profile.display_name || "MHU User").trim().split(" ");
    const lastName = rest.join(" ") || firstName;

    const tokens = await xwLogin();

    // Xpress Wallet validates these as digits-only ("Can only contain
    // digits"), so strip "+", spaces and dashes, and use the local 0XXXXXXXXXX
    // form for Nigerian numbers (+234 / 234 prefix -> 0).
    const normalizePhone = (raw: unknown) => {
      let p = String(raw ?? "").replace(/\D/g, "");
      if (p.startsWith("234") && p.length === 13) p = "0" + p.slice(3);
      return /^0[789]\d{9}$/.test(p) ? p : "";
    };
    // Profile phone first; fall back to the number typed at signup (stored in
    // auth metadata) if the profile value is missing or garbage.
    const cleanPhone = normalizePhone(profile.phone_number) || normalizePhone(user.user_metadata?.phone);
    if (!cleanPhone) {
      return json(
        { error: "The phone number on your profile isn't valid. Update it to an 11-digit Nigerian number (e.g. 08012345678) and try again." },
        { status: 400 }
      );
    }
    if (cleanPhone !== profile.phone_number) {
      await service.from("users").update({ phone_number: cleanPhone }).eq("id", user.id);
    }
    const cleanBvn = String(bvn).replace(/\D/g, "");

    // Tier 2 at creation: per Xpress Wallet's Postman collection, POST /wallet
    // takes `tier` ("TIER_1"|"TIER_2"|"TIER_3") and `nin`. If this user's NIN
    // was verified at signup, ask for TIER_2 up front; if Xpress Wallet
    // rejects that, fall back to a plain BVN-only (Tier 1) wallet so signup
    // never fails because of it.
    const { data: nrow } = await service.from("users").select("verified_nin").eq("id", user.id).maybeSingle();
    const nin = String(nrow?.verified_nin ?? "").replace(/\D/g, "");
    const baseBody = {
      bvn: cleanBvn,
      firstName,
      lastName,
      dateOfBirth,
      phoneNumber: cleanPhone,
      email: profile.email,
      address,
    };
    const createWallet = async (extra: Record<string, unknown>) => {
      const r = await fetch(`${XW_BASE_URL}/wallet`, {
        method: "POST",
        headers: xwAuthHeaders(tokens),
        body: JSON.stringify({ ...baseBody, ...extra }),
      });
      return { res: r, json: await r.json().catch(() => ({})) };
    };

    let attempt = nin.length === 11 ? await createWallet({ tier: "TIER_2", nin }) : await createWallet({});
    if (nin.length === 11 && !(attempt.res.ok && attempt.json?.status)) {
      console.error(
        "xpresswallet-create-wallet: TIER_2 request rejected, falling back to Tier 1",
        JSON.stringify({ http: attempt.res.status, body: attempt.json })
      );
      // Only fall back for validation-type failures, not "already exists".
      if (!/exist|already|duplicate|registered/i.test(String(attempt.json?.message ?? ""))) {
        attempt = await createWallet({});
      }
    }
    const xwRes = attempt.res;
    let xwJson = attempt.json;
    if (!xwRes.ok || !xwJson?.status) {
      console.error(
        "xpresswallet-create-wallet: rejected",
        JSON.stringify({ http: xwRes.status, body: xwJson, phoneSent: cleanPhone, bvnLen: cleanBvn.length })
      );
    }
    let created = xwRes.ok && !!xwJson?.status;

    // "User already exists": Xpress Wallet refuses to create a second
    // customer for the same phone/email/BVN. Instead of failing the user,
    // look up their existing customer + wallet (by their own phone/email)
    // and link that account, so a retry after a half-finished setup, or a
    // wiped xpresswallet_accounts row, still ends with a working account.
    if (!created && /exist|already|duplicate|registered/i.test(String(xwJson?.message ?? ""))) {
      console.log("xpresswallet-create-wallet: customer already exists, trying to link", xwJson?.message);
      const recovered = await findExistingWallet(tokens, cleanPhone, profile.email, cleanBvn);
      if (!recovered) {
        return json(
          {
            error:
              `Xpress Wallet says: "${String(xwJson?.message ?? "already exists").slice(0, 140)}". We couldn't link it automatically (the existing customer isn't under this phone number). Please contact support.`,
          },
          { status: 409 }
        );
      }
      xwJson = recovered;
      created = true;
    }

    if (!created) {
      return json(
        { error: xwJson?.message ?? "Xpress Wallet could not create your account" },
        { status: 502 }
      );
    }

    // Logged so we can see what tier Xpress Wallet actually assigns on live
    // (docs' sample shows "TIER_2" for a BVN-verified customer, but the
    // dashboard has shown Tier 1 -- and Tier 1 recipients get rejected by
    // other banks with "recipient's KYC verification incomplete").
    console.log(
      "xpresswallet-create-wallet: assigned tier",
      JSON.stringify({ tier: xwJson.customer?.tier, mode: xwJson.customer?.mode, nameMatch: xwJson.customer?.nameMatch })
    );

    // Xpress Wallet checks the BVN against the BVN registry and tells us
    // whether the name we sent matches what's on file for it. Surface a
    // clear error instead of silently creating an account under a
    // mismatched name.
    if (xwJson.customer?.nameMatch === false) {
      return json(
        {
          error: "The name on your profile doesn't match the name on this BVN. Update your display name to match your BVN and try again.",
        },
        { status: 422 }
      );
    }

    const account = {
      user_id: user.id,
      xw_customer_id: xwJson.customer.id,
      xw_wallet_id: xwJson.wallet.id,
      account_number: xwJson.wallet.accountNumber,
      account_name: xwJson.wallet.accountName,
      bank_name: xwJson.wallet.bankName,
      bank_code: xwJson.wallet.bankCode,
      status: xwJson.wallet.status ?? "ACTIVE",
    };

    // Never attach one Xpress Wallet customer to two different users.
    const { data: taken } = await service
      .from("xpresswallet_accounts")
      .select("user_id")
      .eq("xw_customer_id", account.xw_customer_id)
      .neq("user_id", user.id)
      .maybeSingle();
    if (taken) {
      return json(
        { error: "This BVN already has a funding account linked to a different MHU account. Log in with that account instead." },
        { status: 409 }
      );
    }

    const { data: inserted, error: insertError } = await service
      .from("xpresswallet_accounts")
      .insert(account)
      .select()
      .single();

    if (insertError) {
      return json({ error: insertError.message }, { status: 500 });
    }

    // KYC tier: use the tier Xpress Wallet ACTUALLY assigned ("TIER_1" /
    // "TIER_2" / "TIER_3" on the customer object) instead of assuming Tier 2
    // -- we previously hardcoded 2, which could disagree with Xpress
    // Wallet's real limits for that customer. If the response carries no
    // tier (e.g. a linked existing account), leave the tier unchanged.
    // Best effort: the account itself was created, so don't fail the
    // request over this.
    const tierNum = Number(String(xwJson.customer?.tier ?? "").match(/[123]/)?.[0]);
    if (tierNum >= 1 && tierNum <= 3) {
      await service.from("users").update({ kyc_tier: tierNum }).eq("id", user.id);
    }

    // Note: bvn/dateOfBirth/address are intentionally NOT persisted anywhere
    // in our own database — the real `users` table has no columns for them,
    // and there's no need to store them ourselves once Xpress Wallet has
    // created the account; they're passed through above and kept only on
    // Xpress Wallet's side.

    return json(inserted);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
