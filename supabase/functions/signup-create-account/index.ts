// Supabase Edge Function: signup-create-account
// Deploy with: supabase functions deploy signup-create-account --no-verify-jwt
//
// Creates the auth account via the Admin API instead of the client calling
// supabase.auth.signUp() directly. Reason: signUp() -- even with the
// account left unconfirmed -- ALWAYS triggers Supabase's own built-in
// "Confirm signup" email (a link, via whatever Auth SMTP is configured),
// completely independent of our custom send-signup-otp/verify-signup-otp
// system. That's what was actually happening: users got Supabase's native
// link email (not ours), clicked it, and landed on the site's homepage
// with nothing confirmed -- instead of typing the 6-digit code on
// VerifyOtp.tsx/CheckEmailScreen like the flow is meant to work.
//
// admin.createUser() with email_confirm: false does NOT send any email at
// all (confirmed Supabase behavior -- Admin API user creation is silent by
// design, meant for exactly this kind of server-controlled onboarding).
// So after this, the ONLY email/SMS a user ever gets is our own, sent by
// the caller's next step (send-signup-otp). verify-signup-otp (unchanged)
// still does the actual confirming via updateUserById(email_confirm: true).
//
// IMPORTANT: deploy with --no-verify-jwt -- runs before any session exists,
// same reasoning as payvessel-verify-nin/bvn.
//
// The public.users profile row is created automatically by the
// on_auth_user_created trigger (see fix_missing_user_profiles.sql) the
// moment this inserts into auth.users -- no client-side profile creation
// needed or attempted here.

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, password, fullName, phone, referredBy, nin } = await req.json();

    if (!email?.trim()) return json({ error: "Email is required" }, { status: 400 });
    if (!password || password.length < 6) {
      return json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    if (!fullName?.trim()) return json({ error: "Full name is required" }, { status: 400 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: false, // stays unconfirmed until verify-signup-otp -- and critically, sends no email itself
      user_metadata: {
        full_name: fullName.trim(),
        phone: phone?.trim() ?? "",
        referred_by: referredBy?.trim() ?? "",
        // Already verified against Payvessel's Basic NIN check before this
        // runs -- stored here so the on_auth_user_created trigger can copy
        // it onto the profile row, letting Fund Wallet skip re-asking for
        // it later (see store_verified_nin.sql).
        nin: nin?.trim() ?? "",
      },
    });

    if (error) {
      // Admin createUser surfaces "already been registered" etc. here --
      // pass it straight through, it's already a clear message.
      return json({ error: error.message }, { status: 400 });
    }

    return json({ userId: data.user.id });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
