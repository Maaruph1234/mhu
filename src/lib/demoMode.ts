// Demo mode turns on automatically whenever there's no real Supabase project
// configured (i.e. you haven't created a .env with VITE_SUPABASE_URL yet).
// It lets every screen — including login/register — work end-to-end against
// local, in-memory fake data instead of a real backend, so you can click
// through the whole app immediately after `npm install && npm run dev`.
//
// Once you add real Supabase/Provibill/Smsala credentials (see README.md),
// this flips off automatically and the app talks to your real backend.
export const isDemoMode = !import.meta.env.VITE_SUPABASE_URL;
