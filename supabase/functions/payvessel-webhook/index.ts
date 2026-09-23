// REMOVED (Sept 2026): Payvessel is no longer used anywhere in this app
// (Virtual Cards, identity verification, and the signup NIN/BVN check were
// its last remaining features -- all removed). See payvessel-verify-nin/
// index.ts's header comment for the full removal history/context.
//
// Left as an inert stub (rather than deleted) because the sandbox this was
// edited from couldn't delete files in this mounted folder -- safe to
// delete by hand, and `supabase functions delete payvessel-webhook` to drop
// the deployed copy. If Payvessel's dashboard still has a callback URL
// pointing at this function, you can remove that configuration too since
// nothing here will ever act on it again.

Deno.serve(() =>
  new Response(JSON.stringify({ error: "This endpoint has been removed." }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
