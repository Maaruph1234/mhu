// Supabase Edge Function: xpresswallet-upgrade-tier
// Deploy with: supabase functions deploy xpresswallet-upgrade-tier
//
// Upgrades the signed-in user's existing Xpress Wallet customer to Tier 2
// using the NIN verified at signup. Based on Xpress Wallet's Postman
// collection (PUT /customer/{id} accepts `tier`; POST /wallet accepts `nin`).
// That is NOT in their docs site, so the result is read back from the API
// (GET /customer/{id}) and only then written to users.kyc_tier -- we never
// assume the upgrade worked. Everything is logged to see what they do.
//
// Optional body: { tier: "TIER_2" } (default). TIER_3 needs a utility bill
// per the SLA and isn't requested here.

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

const tierNumber = (t: unknown) => Number(String(t ?? "").match(/[123]/)?.[0] ?? 0);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anonClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await anonClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, { status: 401 });

    const { data: xwAccount } = await service
      .from("xpresswallet_accounts")
      .select("xw_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!xwAccount?.xw_customer_id) {
      return json({ error: "Set up your funding account first (Fund Wallet)" }, { status: 400 });
    }

    const { data: row } = await service.from("users").select("verified_nin").eq("id", user.id).maybeSingle();
    const nin = String(row?.verified_nin ?? "").replace(/\D/g, "");
    if (nin.length !== 11) {
      return json({ error: "We need your verified NIN to upgrade. Please contact support." }, { status: 400 });
    }

    const tokens = await xwLogin();
    const url = `${XW_BASE_URL}/customer/${xwAccount.xw_customer_id}`;

    const before = await fetch(url, { headers: xwAuthHeaders(tokens) });
    const beforeJson = await before.json().catch(() => ({}));
    const currentTier = tierNumber(beforeJson?.customer?.tier);
    if (currentTier >= 2) {
      await service.from("users").update({ kyc_tier: currentTier }).eq("id", user.id);
      return json({ success: true, tier: currentTier, message: `You're already on Tier ${currentTier}.` });
    }

    const put = await fetch(url, {
      method: "PUT",
      headers: { ...xwAuthHeaders(tokens), "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "TIER_2", nin }),
    });
    const putJson = await put.json().catch(() => ({}));
    console.log("xpresswallet-upgrade-tier: PUT response", JSON.stringify({ http: put.status, body: putJson }));

    // Trust only what Xpress Wallet reports back now.
    const after = await fetch(url, { headers: xwAuthHeaders(tokens) });
    const afterJson = await after.json().catch(() => ({}));
    const newTier = tierNumber(afterJson?.customer?.tier);
    console.log("xpresswallet-upgrade-tier: tier after", newTier);

    if (newTier >= 2) {
      await service.from("users").update({ kyc_tier: newTier }).eq("id", user.id);
      return json({ success: true, tier: newTier, message: `Upgraded to Tier ${newTier}.` });
    }

    return json(
      {
        error:
          putJson?.message && !put.ok
            ? `Xpress Wallet could not upgrade you: ${String(putJson.message).slice(0, 140)}`
            : "Xpress Wallet did not upgrade your tier. They may need your passport photo; we've logged this and will follow up.",
      },
      { status: 422 }
    );
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
