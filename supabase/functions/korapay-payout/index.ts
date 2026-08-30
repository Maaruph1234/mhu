// DEPRECATED: replaced by payvessel-payout (see
// supabase/functions/payvessel-payout/). The website and the Flutter app
// switched their bank-payout provider from Korapay to Payvessel. Nothing
// calls this function anymore. Content replaced with this stub rather than
// deleting the file, since this connected project folder doesn't allow file
// deletion from this tool -- delete the whole korapay-payout/ folder by
// hand if you want it fully gone, and run
// `supabase functions delete korapay-payout` to remove it from the deployed
// project too.
Deno.serve(async () => {
  return new Response(
    JSON.stringify({ error: "korapay-payout is deprecated. Bank transfers now use payvessel-payout." }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
});
