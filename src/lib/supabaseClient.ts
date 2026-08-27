import { createClient } from "@supabase/supabase-js";

// REPLACE: create a project at supabase.com, then copy these two values from
// Project Settings > API into your .env file (see .env.example).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "[MHU Global] Supabase env vars are missing. Copy .env.example to .env and fill in " +
      "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Auth and data calls will fail until then."
  );
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

/**
 * supabase-js's default error.message for a failed Edge Function call is
 * always the generic "Edge Function returned a non-2xx status code" --
 * it does NOT include the actual JSON body our function returned (e.g.
 * {"error": "Insufficient wallet balance"}). That real message is only
 * reachable via error.context, which is the raw Response object. This
 * pulls the real reason out so errors are actually diagnosable instead of
 * always showing the same unhelpful generic text.
 */
export async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: Response } | null;
  if (err?.context && typeof err.context.json === "function") {
    try {
      const body = await err.context.clone().json();
      // Most functions return { error: "..." } on failure, but
      // korapay-verify-bvn returns { verified: false, reason: "..." } --
      // check every field name any edge function actually uses instead of
      // assuming one convention, so this decoder can't silently go blind
      // again the next time a function picks a different key.
      const reason = body?.error ?? body?.reason ?? body?.message;
      if (reason) return String(reason);
    } catch {
      // response body wasn't JSON -- fall through to the generic message
    }
  }
  return err?.message ?? "Something went wrong";
}
