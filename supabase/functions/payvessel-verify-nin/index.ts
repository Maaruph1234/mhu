// REMOVED (Sept 2026): Payvessel is no longer used anywhere in this app.
// Wallet funding/payouts are on Xpress Wallet; identity verification at
// signup was removed entirely -- Xpress Wallet's own BVN check (as part of
// creating a wallet account) is now the only identity verification in the
// system. See README.md's "Payvessel" section for the removal history.
//
// This file is left as an inert stub (rather than deleted) because the
// sandbox this was edited from couldn't delete files in this mounted
// folder -- safe to delete by hand, and `supabase functions delete
// payvessel-verify-nin` to drop the deployed copy.

Deno.serve(() =>
  new Response(JSON.stringify({ error: "This endpoint has been removed." }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
