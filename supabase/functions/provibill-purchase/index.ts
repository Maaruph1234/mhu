// REMOVED (Oct 2026): Provibill was replaced by VTpass (for Cable TV/
// Electricity/Exam Pins) and Hadjibs Data (for Airtime/Data) well before
// this -- this function had already been fully dead/unused since VTpass
// took over. Left in place only because the sandbox couldn't delete files
// in this mounted folder -- safe to delete by hand (and remove this
// function from the Supabase project with `supabase functions delete
// provibill-purchase` if it was ever deployed).
Deno.serve(() => new Response("Provibill has been removed. This function is no longer in use.", { status: 410 }));
