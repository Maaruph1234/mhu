// DEPRECATED: replaced by payvessel-webhook (see
// supabase/functions/payvessel-webhook/). The website and the Flutter app
// switched their virtual-account/payout provider from Korapay to Payvessel.
// Remember to also remove/update the webhook URL configured on Korapay's
// own dashboard so it stops sending events here. Content replaced with this
// stub rather than deleting the file, since this connected project folder
// doesn't allow file deletion from this tool -- delete the whole
// korapay-webhook/ folder by hand if you want it fully gone, and run
// `supabase functions delete korapay-webhook` to remove it from the
// deployed project too.
Deno.serve(async () => {
  return new Response(
    JSON.stringify({ error: "korapay-webhook is deprecated. Payment webhooks now use payvessel-webhook." }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
});
