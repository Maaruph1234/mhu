// REMOVED (Sept 2026): Payvessel is no longer used anywhere in this app.
// See payvessel-verify-nin/index.ts's header comment for the full removal
// history. This one was already dead before the removal (bank payouts
// moved to Xpress Wallet).
//
// Left as an inert stub (rather than deleted) because the sandbox this was
// edited from couldn't delete files in this mounted folder -- safe to
// delete by hand, and `supabase functions delete payvessel-payout` to
// drop the deployed copy.

Deno.serve(() =>
  new Response(JSON.stringify({ error: "This endpoint has been removed." }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
