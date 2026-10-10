// Supabase Edge Function: hadjibs-purchase -- REMOVED (Oct 2026).
// Was briefly the mobile-network subscriber provider (airtime + data) in
// place of VTpass; switched back to VTpass (see vtpass-purchase) after
// repeated integration issues on Hadjibs' side (undocumented trailing-slash
// requirement, wrong auth-header format, wrong network-id format -- their
// own docs never matched the live API's actual behavior). Left deployed as
// a dead-end stub, same pattern as provibill-purchase, so any stale client
// reference gets a clear error instead of a confusing 404.
Deno.serve(() =>
  new Response("Hadjibs Data has been removed -- airtime and data are back on vtpass-purchase. This function is no longer in use.", {
    status: 410,
  })
);
