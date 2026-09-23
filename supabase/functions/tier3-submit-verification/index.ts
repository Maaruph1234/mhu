// Supabase Edge Function: tier3-submit-verification
// Deploy with: supabase functions deploy tier3-submit-verification
//
// Records a Tier 3 (enhanced KYC) document submission for manual review --
// see schema.sql's "KYC tier system" block for the full design. The client
// uploads the actual file directly to the private `tier3-documents` Storage
// bucket first (using the user's own session, under a `{userId}/...` path
// so Storage's own RLS policies allow it), then calls this function with
// the resulting storage path to create the `tier3_verifications` row.
//
// This function does NOT approve/reject anything -- that's done by hand,
// editing the row's `status` column directly in the Supabase table editor.
// A database trigger (handle_tier3_review in schema.sql) bumps the user's
// kyc_tier to 3 automatically the moment status flips to 'approved'.
//
// CORS: called directly from the browser/app, same pattern as every other
// user-invoked edge function here.

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

const VALID_DOCUMENT_TYPES = ["utility_bill", "drivers_license", "voters_card", "passport", "nin_slip"];

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

    const { documentType, documentPath } = await req.json();

    if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType)) {
      return json({ error: "A valid documentType is required" }, { status: 400 });
    }
    if (!documentPath || typeof documentPath !== "string") {
      return json({ error: "documentPath is required" }, { status: 400 });
    }
    // The uploaded path must actually be this user's own -- Storage's RLS
    // already enforces this at upload time (see schema.sql), but checking
    // again here means a forged documentPath pointing at someone else's
    // file gets rejected instead of silently recorded against this user.
    if (!documentPath.startsWith(`${user.id}/`)) {
      return json({ error: "documentPath does not belong to you" }, { status: 403 });
    }

    // Confirm the file actually exists in Storage before recording a
    // submission that points at nothing.
    const folderPath = documentPath.slice(0, documentPath.lastIndexOf("/"));
    const fileName = documentPath.slice(documentPath.lastIndexOf("/") + 1);
    const { data: listed } = await service.storage.from("tier3-documents").list(folderPath);
    if (!listed?.some((f) => f.name === fileName)) {
      return json({ error: "That file wasn't found -- try uploading again" }, { status: 400 });
    }

    const { data: inserted, error: insertError } = await service
      .from("tier3_verifications")
      .insert({
        user_id: user.id,
        document_type: documentType,
        document_url: documentPath,
        status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      return json({ error: insertError.message }, { status: 500 });
    }

    return json(inserted);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
