// DEPRECATED: replaced by payvessel-verify-bvn (see
// supabase/functions/payvessel-verify-bvn/). The website and the Flutter app
// switched their BVN-verification provider from Korapay to Payvessel.
// Nothing calls this function anymore. Content replaced with this stub
// rather than deleting the file, since this connected project folder
// doesn't allow file deletion from this tool -- delete the whole
// korapay-verify-bvn/ folder by hand if you want it fully gone, and run
// `supabase functions delete korapay-verify-bvn` to remove it from the
// deployed project too.
Deno.serve(async () => {
  return new Response(
    JSON.stringify({ error: "korapay-verify-bvn is deprecated. BVN verification now uses payvessel-verify-bvn." }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
});
