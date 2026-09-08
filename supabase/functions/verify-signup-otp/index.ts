// Supabase Edge Function: verify-signup-otp
// Deploy with: supabase functions deploy verify-signup-otp
//
// Checks a code sent by send-signup-otp (either channel -- the code itself
// doesn't know or care which one delivered it) via the verify_signup_otp
// RPC. On success, confirms the underlying Supabase Auth user through the
// Admin API (email_confirm: true) -- the same flag Supabase's own
// link-click confirmation would have set, just set by us instead since
// signup verification no longer goes through Supabase's built-in token.
//
// This does NOT return a session -- confirming a user via the Admin API
// doesn't log anyone in. The caller (Register/VerifyOtp on the web, or
// register/check-email on Flutter) already has the password from the
// signup form still in memory, and calls signInWithPassword itself right
// after this returns success, exactly like the old link-click flow did
// once the user came back and logged in.

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
    const { user_id, code } = await req.json();
    if (!user_id || !code) {
      return json({ error: "user_id and code are required" }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: ok, error } = await supabase.rpc("verify_signup_otp", {
      p_user_id: user_id,
      p_code: String(code).trim(),
    });
    if (error) return json({ error: error.message }, { status: 500 });
    if (!ok) return json({ error: "Incorrect or expired code" }, { status: 400 });

    const { error: confirmError } = await supabase.auth.admin.updateUserById(user_id, {
      email_confirm: true,
    });
    if (confirmError) return json({ error: confirmError.message }, { status: 500 });

    return json({ success: true });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
