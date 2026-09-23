// REMOVED (Sept 2026): the extra-document identity verification feature
// (license/voter's card/passport, and Payvessel entirely) has been removed
// from this app. See payvessel-verify-nin/index.ts's header comment for the
// full removal history/context.
//
// Left as an inert stub (rather than deleted) because the sandbox this was
// edited from couldn't delete files in this mounted folder -- safe to
// delete by hand, and `supabase functions delete payvessel-identity` to
// drop the deployed copy. The `identity_verifications` table in schema.sql
// can be dropped too once you've confirmed there's no data you still need
// from it.

Deno.serve(() =>
  new Response(JSON.stringify({ error: "This endpoint has been removed." }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
