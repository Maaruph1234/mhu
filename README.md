# MHU Global — Web App

A React + TypeScript + Tailwind web app for MHU Global: a wallet that covers
airtime, data, TV subscriptions, electricity bills, exam pins, instant
peer-to-peer transfers, USD virtual cards, extra ID verification, eSIM data
packages, and flight booking. Visual style is a light fintech theme.
Backend: Supabase (auth, database, edge functions, and built-in email OTP
for signup verification), Hadjibs Data (airtime/data fulfillment, as of Oct
2026), VTpass (TV/electricity/exam-pin fulfillment — no longer airtime/data,
see the "Hadjibs Data" and "VTpass" sections below), Xpress Wallet (wallet
funding + bank payouts via a real Providus Bank account per user).

This app shares ONE Supabase project with a companion Flutter mobile app
("MHU Super App"). Every edge function listed below is deployed ONCE and
used by both apps — the Flutter app's own README doesn't repeat these
deployment steps, it just points back here.

This is a working scaffold with real integration code, not a finished
production app — the sections below list exactly what to fill in before it
can go live.

## 1. Run it locally

```bash
npm install
cp .env.example .env   # then fill in the Supabase values (see below)
npm run dev
```

## 2. What you must replace before this works end-to-end

### Supabase (required for anything to work)
This website shares the SAME Supabase project as the Flutter app (project
"mhu-app") — not a new one. That project already has real `users`,
`transactions`, and `otp_codes` tables with their own shape (see the
comment at the top of `supabase/schema.sql` for the exact real columns).
The website's code (`AuthContext`, `WalletContext`, the edge functions) is
written against that real schema — `users.wallet_balance` instead of a
separate wallets table, `display_name`/`phone_number` instead of
`full_name`/`phone`, `title`/`subtitle` on transactions instead of
`description`/`fee`, and no `referral_code`/`bvn`/`date_of_birth`/`address`
columns (referral codes are derived client-side from the user's id; BVN/DOB/
address are passed through to Korapay without being stored locally).
1. Run `supabase/schema.sql` in the SQL editor of that SAME project. It's
   additive only — it does NOT touch `users`/`transactions`/`otp_codes`,
   it only adds the `korapay_accounts` table (plus the unused
   `xpresswallet_accounts` table left over from an earlier attempt) and a
   rewritten `transfer_funds` function that matches the real column names.
2. Copy **Project Settings > API > Project URL** and **anon public key**
   from that project into `.env` as `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY`.
4. Deploy the edge functions in `supabase/functions/`:
   ```bash
   supabase functions deploy hadjibs-purchase
   supabase functions deploy vtpass-purchase
   supabase functions deploy smsala-send-otp
   ```
   (plus the Xpress Wallet functions listed further down.)

### Signup verification (email OTP via Supabase Auth — not Smsala)
Account verification after signup now uses Supabase Auth's own built-in
email OTP, not Smsala/SMS. `supabase.auth.signUp()` automatically sends a
"Confirm signup" email; the user enters the 6-digit code on `/verify-otp`
and the app calls `supabase.auth.verifyOtp({ email, token, type: "signup" })`.
Regular login (`/login`) is unaffected and stays plain email + password —
the OTP step only happens once, right after registering.

**Required dashboard step:** in the Supabase dashboard, go to
**Authentication > Email Templates > Confirm signup** and make sure the
template includes `{{ .Token }}` (the 6-digit code), not just
`{{ .ConfirmationURL }}` (a magic link). Without that, `verifyOtp` has
nothing valid to check the user's entered code against. No new secrets or
edge function deploys are needed for this — it's handled entirely by
Supabase Auth.

`src/lib/smsala.ts` and `supabase/functions/smsala-send-otp/index.ts` are
left in place but are no longer called by the signup/verification flow —
keep them around only if you plan to use Smsala for other SMS notifications
later, otherwise they're safe to delete.

- Get an API token and approved sender ID from smsala.com if you do keep it.
- Set them as **Supabase function secrets** (never in frontend `.env` —
  they're private keys used only inside the edge function):
  ```bash
  supabase secrets set SMSALA_API_TOKEN=xxx SMSALA_SENDER_ID=xxx
  ```
- `supabase/functions/smsala-send-otp/index.ts` has a placeholder request
  shape (`api_id`, `sender_id`, `message`, `numbers`) — confirm the exact
  field names against Smsala's current API docs/dashboard and adjust.

### Hadjibs Data (airtime, data)
Hadjibs Data (hadjibsdata.com.ng) is the mobile-network subscriber provider
as of Oct 2026, replacing VTpass for airtime + data specifically. Every
endpoint/field used in `supabase/functions/hadjibs-purchase/index.ts` is
confirmed directly against the account's own logged-in API docs page
(Profile > API Access > API Docs) — a short list: `GET /api/user` (balance),
`POST /api/data`, `POST /api/airtime`.

- Auth is a single API key — no secret/public key split. Copy it from
  Profile > API Access on your Hadjibs account, then set as a Supabase
  function secret:
  ```bash
  supabase secrets set HADJIBS_API_KEY=xxx
  ```
- Hadjibs has no live "list data plans" endpoint, unlike VTpass — the full
  data-plan catalog (network, numeric Plan Id, name, price) is hand-
  transcribed from the account's own Pricing page into
  `src/data/hadjibsDataPlans.ts` (and mirrored in the Flutter app's
  `lib/shared/data/hadjibs_data_plans.dart`). Re-scrape that page
  periodically — Hadjibs adds/removes/reprices plans with no notice.
- No 9mobile data bundles are offered yet (Hadjibs' Pricing page has no
  9MOBILE rows in its Data Plan table) — 9mobile airtime still works.
- No requery/status-check endpoint exists — once `/api/data` or
  `/api/airtime` responds, that's the only signal available; see the
  header comment in `hadjibs-purchase/index.ts` for how an ambiguous
  network timeout is handled.
- The doc's own example (`plan=500MB`) doesn't match the real numeric Plan
  Ids in the Pricing table (e.g. `217`) — this codebase uses the numeric
  ids, which is what a reseller API actually expects, but re-confirm
  against a real test purchase before relying on it live.

### VTpass (TV, electricity, exam pins)
VTpass (see vtpass.com/documentation) is the fulfillment provider for the
three products Hadjibs' public API doesn't offer — no longer airtime/data
(see "Hadjibs Data" above). Every endpoint/field used in
`supabase/functions/vtpass-purchase/index.ts` is confirmed directly against
VTpass's own docs (auth headers, `/pay`, `/requery`, `/merchant-verify`,
`/service-variations`), not guessed.

- Get your API key, secret key, and public key from your VTpass sandbox
  account (Profile > API Keys at sandbox.vtpass.com), then set as Supabase
  function secrets:
  ```bash
  supabase secrets set VTPASS_API_KEY=xxx VTPASS_SECRET_KEY=xxx VTPASS_PUBLIC_KEY=xxx VTPASS_BASE_URL=https://sandbox.vtpass.com/api
  ```
  Switch `VTPASS_BASE_URL` to `https://vtpass.com/api` once VTpass
  provisions your account for the live environment (request this from
  their support after sandbox testing is complete).
- **Sandbox test values** (only work against the sandbox base URL):
  electricity and TV purchases succeed when the meter/smartcard number is
  `1111111111111` (prepaid) or `1010101010101` (postpaid).
- Service IDs are hardcoded in `vtpass-purchase/index.ts`
  (`TV_IDS`/`ELECTRICITY_IDS`/`EXAM_IDS`) rather than looked up live, since
  VTpass's service IDs are stable and documented — confirmed against
  VTpass's own per-product doc pages, not guessed. Note electricity service
  IDs follow a `{cityname}-electric` pattern (e.g. `portharcourt-electric`,
  not `phed-electric`) — don't assume the disco abbreviation matches the
  service ID.
- **NECO is not supported.** VTpass only offers WAEC (Registration + Result
  Checker) and JAMB pins, no NECO result-checker product. The exam-pin UI
  still lists NECO as an option (see `src/data/reference.ts`) — purchases
  for it return a clear error rather than silently hitting the wrong
  product. Remove it from the UI, or find an alternate provider for NECO
  specifically, before going live.
- No IP whitelisting or proxy setup required — VTpass is a standard HTTPS
  REST API reachable from anywhere.
- The TV bouquets and prices in `src/data/reference.ts` are still
  placeholders — replace with real values from VTpass's
  `/service-variations?serviceID=X` endpoint for accurate pricing.

### Provibill (REMOVED)
Provibill was the original bill payment provider but was abandoned after
its bank-provided sandbox server was never reachable, despite extensive
troubleshooting (confirmed our IP, proxy, and port all worked correctly
against other servers — the block was on their firewall/server, never
resolved). It was fully dead/unused since VTpass took over, and has now
been removed — `src/lib/provibill.ts` and
`supabase/functions/provibill-purchase/` are stub files noting the removal
(the sandbox this was built in couldn't delete files in this mounted
folder; delete them by hand).

### Payvessel — wallet funding, payouts, BVN check, virtual cards, identity verification, eSIM, flights
Payvessel (docs.payvessel.com) is now the provider for everything that used
to be split across Korapay (funding/payout/BVN) and Monnify (the Flutter
app's old funding rail), PLUS four brand-new features not in the original
scope. Every endpoint/field/webhook shape below is confirmed directly
against Payvessel's own docs, not guessed. All Payvessel functions share
three base secrets:
```bash
supabase secrets set PAYVESSEL_API_KEY=PVTESTKEY-xxx PAYVESSEL_SECRET=PVTESTSECRET-xxx PAYVESSEL_BASE_URL=https://sandbox.payvessel.com
```
Switch `PAYVESSEL_BASE_URL` to `https://api.payvessel.com` once you move to
live keys.

**Wallet funding (virtual bank account).** `payvessel-create-account`
creates a permanent NGN virtual account per user (Payvessel's
`customerReservedAccount` product), stored in the `payvessel_accounts`
table. Also needs `PAYVESSEL_BUSINESS_ID` (from your Payvessel dashboard,
separate from the API key/secret):
```bash
supabase secrets set PAYVESSEL_BUSINESS_ID=xxx
supabase functions deploy payvessel-create-account
```
BVN is mandatory for a STATIC account, same regulatory requirement Korapay
had. `payvessel-verify-bvn` (deploy with `--no-verify-jwt`, since it runs
before the user has a session) gates registration the same way the old
Korapay BVN check did, using Payvessel's **Basic** BVN Verification (switched
from Enhanced, Sept 2026 — Enhanced was confirmed with Payvessel support to
intermittently return a different person's identity, reproduced live in
their own docs.payvessel.com playground on a real BVN. Basic requires more
input up front — first/middle/last name, gender, date of birth, phone — and
returns match verdicts rather than the record's own data, but was reliable
in that same test. See the function's header comment for full detail).

**Payouts (transfer to bank).** `payvessel-payout` lists banks, resolves an
account number to a name, and disburses — same three-action shape the old
`korapay-payout` had. Deploy: `supabase functions deploy payvessel-payout`.

**Webhooks.** `payvessel-webhook` (deploy with `--no-verify-jwt`) handles
`reserved_account.credit` (wallet funding), `transfer.success` /
`transfer.failed` / `transfer.reversed` (payout resolution, with automatic
wallet refund on failure), and the virtual-card issuing events described
below. Signature: HMAC-SHA512 of the raw body using your secret as the key;
set the deployed function's URL as your webhook URL in the Payvessel
dashboard. **Note:** Payvessel's own docs show the verification header via
Django's internal `HTTP_PAYVESSEL_HTTP_SIGNATURE` name rather than the
literal wire header — `payvessel-webhook/index.ts` checks a few plausible
real header names defensively and logs all received header names if none
match, so a mismatch is diagnosable from the function logs on your first
real webhook delivery rather than failing silently.

**Webhook URL must match your business website's domain.** Payvessel's
dashboard rejects a webhook URL that isn't on the same domain as your
registered business website (rejects raw `*.supabase.co` URLs outright).
`vercel.json` at the project root proxies `https://mhuglobal.com/api/
payvessel-webhook` through to the real Supabase function URL (Vercel
rewrites to an external destination forward the method, headers, and raw
body unchanged, so HMAC signature verification still works against the
untouched body). Register `https://mhuglobal.com/api/payvessel-webhook` —
not the supabase.co URL — as the webhook URL in the Payvessel dashboard.

**Virtual USD cards (issuing).** New feature — a user can create a
Visa/Mastercard USD card (full KYC per card: BVN, NIN, DOB, address, an ID
photo), fund/withdraw it against their own NGN wallet, freeze/unfreeze,
terminate, and view its transaction history. Payvessel issues every card
under ONE shared business account with no per-customer scoping on their
side, so `payvessel-cards/index.ts` and the `virtual_cards` table are what
make per-user isolation possible — read that function's header comment
before touching it. Deploy:
```bash
supabase secrets set PAYVESSEL_USD_NGN_RATE=1500
supabase functions deploy payvessel-cards
```
`PAYVESSEL_USD_NGN_RATE` is a manually maintained NGN-per-USD number, NOT a
live FX feed — there's no exchange-rate API wired in. Update it
periodically; the fallback bakes in a margin over the interbank rate at the
time this was written (check a source like xe.com or the CBN rate before
relying on the default for real money). You'll also need to fund your
Payvessel **business USD wallet** from their dashboard before any card can
actually be funded — that's separate money from the NGN wallet used for
funding/payouts.

**Extra ID verification.** New feature, on the Profile page — a user can
verify NIN (enhanced), driver's license, voter's card, or international
passport, stored in `identity_verifications` (one row per user per doc
type). **Every check costs Payvessel ~₦25 from OUR business wallet, even
when the document isn't found** — `payvessel-identity/index.ts` charges a
flat fee from the user's own wallet to cover that (and prevent abuse), only
when Payvessel actually processed the request. Deploy:
```bash
supabase secrets set IDENTITY_VERIFICATION_FEE_NGN=150
supabase functions deploy payvessel-identity
```

**eSIM data packages.** New feature — browse regions/packages and buy an
eSIM, tracked in `esim_orders`. Payvessel's package list already returns
`price_naira` directly, so no exchange-rate guessing is needed here (unlike
cards). Deploy: `supabase functions deploy payvessel-esim`.

**Flight booking.** New feature — search flights (one-way, round-trip, or
multi-city, up to 5 legs), pick a cabin class, lock in a quote, and book a
multi-passenger itinerary (adults/children/infants, each with their own
passenger-details form), tracked in `flight_quotes` (so the exact priced
total Payvessel already validated at quote time is what gets charged,
never a client-supplied number) and `flight_orders`. Payvessel's "List
Flight Orders" endpoint is business-wide the same way card listing is, so
`flight_orders`/`flight_quotes` provide the same per-user isolation
`virtual_cards` does. Deploy: `supabase functions deploy payvessel-flight`
(the quote action's response also now includes `airlineLogoUrl`, so
redeploy if you're updating from an older version of this function).

### Wallet funding / bank payouts — provider history (current: Xpress Wallet)
This has switched providers more than once. As of Sept 2026:

- **Xpress Wallet (Providus Bank) — ACTIVE.** `src/lib/xpressWallet.ts` plus
  `xpresswallet-create-wallet`, `xpresswallet-transfer`, `xpresswallet-webhook`,
  and `_shared/xpresswallet-auth.ts` power Fund Wallet and Transfer → Transfer
  to bank. Endpoints confirmed against developer.providusbank.com's live
  docs. Unlike every provider before it, the dedicated account created per
  user is a REAL Providus Bank account with its own live balance on Xpress
  Wallet's side (not a pass-through virtual account) — this app still keeps
  `users.wallet_balance` as the single source of truth for spending
  everywhere else, kept in sync by these functions rather than read from
  Xpress Wallet directly. See `.env.example`'s Xpress Wallet section for
  required secrets and two open unknowns worth confirming against a real
  sandbox call before going live: whether login credentials need base64
  encoding, and the real webhook payload shape (logged to
  `xpresswallet_webhook_events` for exactly this reason).
- **Korapay — REMOVED (Sept 2026).** Nothing in either app calls Korapay
  anymore. Its one remaining job, BVN/NIN verification at signup, moved to
  Payvessel (`payvessel-verify-bvn`/`payvessel-verify-nin`) — the website's
  `src/lib/payvessel.ts` shim was still forwarding `verifyBvn`/`verifyNin`
  to `src/lib/korapay.ts` even after Register.tsx's own comments and the
  Payvessel edge functions assumed it was on Payvessel; that was a leftover
  bug from an incomplete migration (the Flutter app's `register_screen.dart`
  never had it — it already called `payvessel-verify-nin` directly). Fixed
  by rewiring the shim to call the Payvessel functions directly.
  `src/lib/korapay.ts` and the `korapay-*` edge functions
  (`korapay-verify-bvn`, `korapay-verify-nin`, `korapay-create-account`,
  `korapay-payout`, `korapay-webhook`) have been deleted from the website
  repo — if `supabase functions list` still shows them deployed, drop them
  with `supabase functions delete <name>`, and remove any `KORAPAY_*`
  secrets with `supabase secrets unset`.
- **Payvessel — REMOVED (Sept 2026).** Was used for the signup NIN check,
  USD virtual card issuing, and extra-document identity verification; the
  user explicitly asked for Payvessel and Korapay gone entirely, Xpress
  Wallet only. Signup no longer runs any third-party identity check at all
  — the real identity check now happens once, later, when Xpress Wallet's
  own `POST /wallet` call validates a user's BVN as part of creating their
  dedicated Providus Bank account. Virtual Cards and extra-document
  identity verification are no longer offered in the app (UI entry points
  removed). `src/lib/payvessel.ts` and the `payvessel-*` edge functions are
  stub files noting the removal (the sandbox this was built in couldn't
  delete files in this mounted folder; delete them by hand). A Tier 1/2/3
  KYC system (`kyc_tier` on `users`, `tier3_verifications` table, manual
  review) replaced Payvessel's old automated document checks for anyone
  who needs higher limits — see `supabase/schema.sql`'s "KYC tier system"
  block and `src/components/dashboard/TierCard.tsx`.
- **Monnify** (Flutter app's `monnify-payment` function) — untouched by any
  of the above; not part of this history.

### App Store / Play Store badges
- Set `VITE_APP_STORE_URL` and `VITE_PLAY_STORE_URL` in `.env` once the
  Flutter app has real listing pages. Until then the badges link to `#`.

## 3. Project structure

```
src/
  components/ui/          Buttons, cards, inputs, wallet card, store badges, etc.
  components/dashboard/   TierCard (KYC tier + Tier 3 submission, Profile page section)
  components/layout/      Marketing nav/footer, dashboard sidebar, auth layout
  context/                 AuthContext (Supabase auth), WalletContext (balance + transactions)
  lib/                     supabaseClient, smsala.ts, hadjibs.ts (ACTIVE -- airtime/data),
                           vtpass.ts (ACTIVE -- TV/electricity/exam-pins), provibill.ts (removed,
                           stub), xpressWallet.ts (ACTIVE -- wallet funding + bank payouts),
                           tier3.ts (Tier 3 manual-review submission), format.ts
  data/reference.ts        Static network/TV/disco/exam-body reference data (placeholders — see above)
  data/hadjibsDataPlans.ts Hadjibs Data's real data-plan catalog (hand-transcribed, see above)
  lib/dataPlanCategories.ts Buckets data-plan/TV-bouquet variations into Daily/Weekly/Monthly/etc.
  pages/marketing/         Landing page
  pages/auth/              Login, Register, OTP verification, Forgot/Reset password
  pages/dashboard/         Overview, Fund, Transfer, Airtime, Data, TV, Electricity, Exam Pins,
                           Transactions, Referrals, Profile
supabase/
  schema.sql               Tables, RLS policies, transfer_funds RPC, KYC tier system
  functions/                Edge functions that hold the real Hadjibs/VTpass/Smsala/Xpress Wallet
                           secret keys (plus stub Provibill/Payvessel/Korapay ones, all removed --
                           see the provider-history sections above)
```

## 4. Why Hadjibs/VTpass/Smsala calls go through Supabase Edge Functions

Hadjibs Data, VTpass, and Smsala all require secret credentials. Secrets
must never ship in frontend JavaScript (anyone can open dev tools and read
them), so `src/lib/hadjibs.ts`, `src/lib/vtpass.ts`, and `src/lib/smsala.ts`
never call those APIs directly — they call a Supabase Edge Function
(`supabase.functions.invoke(...)`), and the edge function (which runs
server-side, holding the real secrets) makes the actual Hadjibs/VTpass/
Smsala request.

## 5. Build

```bash
npm run build   # outputs to dist/
```
