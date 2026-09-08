// Supabase Edge Function: send-signup-otp
// Deploy with: supabase functions deploy send-signup-otp
//
// Generates a fresh 6-digit signup-verification code (via the
// create_signup_otp RPC -- see supabase/signup_otp_schema.sql) and
// delivers it through whichever channel the caller asks for:
//   channel: "email" -> Resend's HTTP API (api.resend.com/emails)
//   channel: "sms"   -> SMSala's plain Send SMS API (smsala.com/docs)
// Called both right after signUp() (first code) and every time the user
// taps "resend" on either platform's verify screen -- "resend via the
// other channel" is just calling this again with a different `channel`.
// No auth check here (the account isn't confirmed yet, so there's no
// session to check) -- user_id is only ever passed in right after this
// project's own signUp() call, from code we control, not user input.
//
// Secrets required:
//   RESEND_API_KEY, RESEND_FROM_EMAIL (e.g. "MHU Global <noreply@yourdomain.com>",
//     must be on the domain you verified in Resend)
//   SMSALA_API_TOKEN (the "Api Token" shown against your SMSala end point
//     in the customer panel -- SMSala's V2 API auths with a single token,
//     not api_id/api_password)
//   SMSALA_SENDER_ID (your approved alphanumeric Sender ID from the
//     SMSala panel -- required, SMSala rejects unapproved sender IDs)

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

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "";

const SMSALA_API_TOKEN = Deno.env.get("SMSALA_API_TOKEN") ?? "";
const SMSALA_SENDER_ID = Deno.env.get("SMSALA_SENDER_ID") ?? "";

// SMSala wants country code + number, no "+", no leading 0 -- e.g.
// "08012345678" -> "2348012345678". Nigeria-only, consistent with the rest
// of this project (NIN/BVN, VTpass, Payvessel are all Nigeria-scoped).
function toSmsalaPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return `234${digits.slice(1)}`;
  return `234${digits}`;
}

async function sendEmail(email: string, code: string) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error("Email verification is temporarily unavailable. Please try SMS instead.");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: email,
      subject: "Your MHU Global verification code",
      html:
        `<p>Your MHU Global verification code is:</p>` +
        `<h2 style="letter-spacing:6px;font-size:32px">${code}</h2>` +
        `<p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("send-signup-otp: Resend error", text);
    throw new Error("Could not send the verification email. Please try again.");
  }
}

async function sendSms(phone: string, code: string) {
  if (!SMSALA_API_TOKEN || !SMSALA_SENDER_ID) {
    throw new Error("SMS verification is temporarily unavailable. Please try email instead.");
  }
  // SMSala's V2 token API (api2.smsala.com/SendSmsV2, confirmed against
  // their own PDF integration doc) -- NOT the older api_id/api_password
  // endpoint. messageType "3" = OTP (a dedicated type SMSala provides
  // specifically for this), messageEncoding "1" = Default (plain text).
  // destinationAddress needs country code + number, no "+" (Nigeria-only
  // here, matching the rest of this project).
  const res = await fetch("https://api2.smsala.com/SendSmsV2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      {
        apiToken: SMSALA_API_TOKEN,
        messageType: "3",
        messageEncoding: "1",
        destinationAddress: toSmsalaPhone(phone),
        sourceAddress: SMSALA_SENDER_ID,
        messageText: `Your MHU Global verification code is ${code}. It expires in 10 minutes.`,
      },
    ]),
  });
  const smsJson = await res.json().catch(() => null);
  console.log("send-signup-otp: SMSala response", JSON.stringify(smsJson));
  const first = Array.isArray(smsJson) ? smsJson[0] : smsJson;
  const status = first?.Status ?? first?.status;
  if (status !== "Success") {
    throw new Error((first?.Remarks ?? first?.remarks) ?? "Could not send the verification SMS. Please try again.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { user_id, email, phone, channel } = await req.json();
    if (!user_id || !channel) {
      return json({ error: "user_id and channel are required" }, { status: 400 });
    }
    if (channel !== "email" && channel !== "sms") {
      return json({ error: 'channel must be "email" or "sms"' }, { status: 400 });
    }
    if (channel === "email" && !email) {
      return json({ error: "email is required for the email channel" }, { status: 400 });
    }
    if (channel === "sms" && !phone) {
      return json({ error: "phone is required for the sms channel" }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: code, error } = await supabase.rpc("create_signup_otp", {
      p_user_id: user_id,
      p_channel: channel,
    });
    if (error || !code) {
      return json({ error: error?.message ?? "Could not generate a verification code" }, { status: 500 });
    }

    if (channel === "email") {
      await sendEmail(email, code as string);
    } else {
      await sendSms(phone, code as string);
    }

    return json({ success: true, channel });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
