// DEPRECATED: replaced by payvessel-create-account (see
// supabase/functions/payvessel-create-account/). The website and the
// Flutter app switched their virtual-account/funding provider from Korapay
// to Payvessel. Nothing calls this function anymore. Content replaced with
// this stub rather than deleting the file, since this connected project
// folder doesn't allow file deletion from this tool -- delete the whole
// korapay-create-account/ folder by hand if you want it fully gone, and run
// `supabase functions delete korapay-create-account` to remove it from the
// deployed project too.
Deno.serve(async () => {
  return new Response(
    JSON.stringify({ error: "korapay-create-account is deprecated. Wallet funding accounts now use payvessel-create-account." }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
});
