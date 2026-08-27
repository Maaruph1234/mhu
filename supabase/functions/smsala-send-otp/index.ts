// Supabase Edge Function: smsala-send-otp
// Deploy with: supabase functions deploy smsala-send-otp
// Secrets required: SMSALA_API_TOKEN, SMSALA_SENDER_ID
//
// Smsala (https://smsala.com) is used here purely for delivering the OTP SMS.
// The OTP code itself is generated and checked against a short-lived row in
// the `otp_codes` table (service_role only) so the code never has to round
// trip through Smsala for verification.

import { createClient } from "npm:@supabase/supabase-js@2";

const SMSALA_API_TOKEN = Deno.env.get("SMSALA_API_TOKEN") ?? "";
const SMSALA_SENDER_ID = Deno.env.get("SMSALA_SENDER_ID") ?? "MHU Global";
const SMSALA_BASE_URL = "https://api.smsala.com/api/SendSMS"; // confirm exact path in Smsala's docs/dashboard

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();
    const { phone, action } = body;

    if (!phone) {
      return new Response(JSON.stringify({ error: "Phone number required" }), { status: 400 });
    }

    if (action === "verify") {
      const { code } = body;
      const { data: row } = await supabase
        .from("otp_codes")
        .select("*")
        .eq("phone", phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      const valid =
        row && row.otp === code && new Date(row.expires_at).getTime() > Date.now();

      if (valid) {
        await supabase.from("otp_codes").delete().eq("phone", phone);
      }

      return new Response(JSON.stringify({ success: !!valid }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // action === "send"
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Real `otp_codes` table's primary key is `id` (not `phone`), so this
    // is a plain insert rather than an upsert — each send just adds a new
    // row, and verify above always checks the most recent one for that
    // phone number. Assumes `id` has a database default (e.g.
    // gen_random_uuid()), matching every other table in this schema.
    await supabase.from("otp_codes").insert({ phone, otp: code, expires_at: expiresAt });

    const requestId = `OTP-${Date.now()}`;

    // REPLACE: confirm Smsala's exact request shape (query params vs JSON
    // body, field names) from smsala.com's API docs / dashboard once you have
    // an account — this mirrors their commonly documented REST pattern.
    const smsRes = await fetch(SMSALA_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_id: SMSALA_API_TOKEN,
        sender_id: SMSALA_SENDER_ID,
        message: `Your MHU Global verification code is ${code}. It expires in 10 minutes.`,
        numbers: phone,
      }),
    });

    const smsOk = smsRes.ok;

    return new Response(JSON.stringify({ success: smsOk, requestId }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
