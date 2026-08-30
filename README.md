# MHU Global — Web App

A React + TypeScript + Tailwind web app for MHU Global: a wallet that covers
airtime, data, TV subscriptions, electricity bills, exam pins, instant
peer-to-peer transfers, USD virtual cards, extra ID verification, eSIM data
packages, and flight booking. Visual style is a light fintech theme.
Backend: Supabase (auth, database, edge functions, and built-in email OTP
for signup verification), VTpass (airtime/data/TV/electricity/exam-pin
fulfillment), Payvessel (wallet funding, bank payouts, BVN/identity
verification, USD virtual card issuing, eSIM, and flight booking — Payvessel
replaced Korapay and Monnify as of this revision; see the "Payvessel"
sections below for the full API surface now in use).

This app shares ONE Supabase project with a companion Flutter mobile app
("MHU Super App"). Every Payvessel edge function listed below is deployed
ONCE and used by both apps — the Flutter app's own README doesn't repeat
these deployment steps, it just points back here.

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
   supabase functions deploy provibill-purchase
   supabase functions deploy smsala-send-otp
   ```
   (plus the two Korapay functions listed further down.)

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

### VTpass (airtime, data, TV, electricity, exam pins)
VTpass (see vtpass.com/documentation) is the live bill payment/VTU
fulfillment provider. Every endpoint/field used in
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
- **Sandbox test values** (only work against the sandbox base URL): airtime
  and data purchases succeed when `phone` is `08011111111` (any other
  number simulates a failure); electricity and TV purchases succeed when
  the meter/smartcard number is `1111111111111` (prepaid) or
  `1010101010101` (postpaid).
- Service IDs are hardcoded in `vtpass-purchase/index.ts`
  (`AIRTIME_IDS`/`DATA_IDS`/`TV_IDS`/`ELECTRICITY_IDS`/`EXAM_IDS`) rather
  than looked up live, since VTpass's service IDs are stable and documented
  — confirmed against VTpass's own per-product doc pages, not guessed.
  Note electricity service IDs follow a `{cityname}-electric` pattern (e.g.
  `portharcourt-electric`, not `phed-electric`) — don't assume the disco
  abbreviation matches the service ID.
- **NECO is not supported.** VTpass only offers WAEC (Registration + Result
  Checker) and JAMB pins, no NECO result-checker product. The exam-pin UI
  still lists NECO as an option (see `src/data/reference.ts`) — purchases
  for it return a clear error rather than silently hitting the wrong
  product. Remove it from the UI, or find an alternate provider for NECO
  specifically, before going live.
- No IP whitelisting or proxy setup required — VTpass is a standard HTTPS
  REST API reachable from anywhere, unlike Provibill (see below).
- The data plans, TV bouquets and prices in `src/data/reference.ts` are
  still placeholders — replace with real values from VTpass's
  `/service-variations?serviceID=X` endpoint for accurate pricing.

### Provibill (not currently used — left in place, unused)
Provibill was the original bill payment provider but was abandoned after
its bank-provided sandbox server was never reachable, despite extensive
troubleshooting (confirmed our IP, proxy, and port all worked correctly
against other servers — the block was on their firewall/server, never
resolved). `src/lib/provibill.ts` and
`supabase/functions/provibill-purchase/` are left in the codebase, unused,
in case that connectivity issue gets resolved later and it's worth
revisiting. VTpass replaces it as the active integration; none of the
5 VTU pages import from `lib/provibill` anymore.

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
Korapay BVN check did, using Payvessel's Enhanced BVN Verification.

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

### Korapay / Monnify (superseded, left in place unused)
`src/lib/korapay.ts`, the four `korapay-*` edge functions, and the Flutter
app's `monnify-payment` function are all replaced by Payvessel above and
have been turned into `410`-returning stubs (or, for `korapay.ts`, marked
deprecated in a header comment) rather than deleted, since delete access to
this codebase isn't available from this tool. Nothing in either app calls
them anymore. Safe to delete the whole files/folders by hand if you want
them fully gone, and run `supabase functions delete <name>` to remove the
stubs from the deployed project too.

### Xpress Wallet (not currently used — left in place, unused)
Xpress Wallet (Providus Bank) was an early wallet-funding attempt on the
website, abandoned before Korapay (and now Payvessel). `src/lib/xpressWallet.ts`
is left in the codebase, unused.

### App Store / Play Store badges
- Set `VITE_APP_STORE_URL` and `VITE_PLAY_STORE_URL` in `.env` once the
  Flutter app has real listing pages. Until then the badges link to `#`.

## 3. Project structure

```
src/
  components/ui/          Buttons, cards, inputs, wallet card, store badges, etc.
  components/dashboard/   IdentityVerificationCard (Profile page section)
  components/layout/      Marketing nav/footer, dashboard sidebar, auth layout
  context/                 AuthContext (Supabase auth), WalletContext (balance + transactions)
  lib/                     supabaseClient, smsala.ts, vtpass.ts, provibill.ts, korapay.ts (superseded),
                           payvessel.ts, virtualCards.ts, identityVerification.ts, esim.ts, flights.ts,
                           xpressWallet.ts, format.ts (client-side service wrappers --
                           provibill.ts/korapay.ts/xpressWallet.ts unused, kept for reference)
  data/reference.ts        Static network/TV/disco/exam-body reference data (placeholders — see above)
  pages/marketing/         Landing page
  pages/auth/              Login, Register, OTP verification, Forgot password
  pages/dashboard/         Overview, Fund, Transfer, Airtime, Data, TV, Electricity, Exam Pins,
                           VirtualCard, Esim, FlightBooking, Transactions, Referrals, Profile
supabase/
  schema.sql               Tables, RLS policies, transfer_funds RPC
  functions/                Edge functions that hold the real VTpass/Smsala/Payvessel secret keys
                           (plus unused Provibill/Xpress Wallet/Korapay ones, the latter now 410 stubs)
```

## 4. Why VTpass/Payvessel/Smsala calls go through Supabase Edge Functions

VTpass, Payvessel, and Smsala all require secret credentials. Secrets must
never ship in frontend JavaScript (anyone can open dev tools and read
them), so `src/lib/vtpass.ts`, `src/lib/payvessel.ts` (and its
`virtualCards.ts`/`identityVerification.ts`/`esim.ts`/`flights.ts`
siblings), and `src/lib/smsala.ts` never call those APIs directly — they
call a Supabase Edge Function (`supabase.functions.invoke(...)`), and the
edge function (which runs server-side, holding the real secrets) makes the
actual VTpass/Payvessel/Smsala request.

## 5. Build

```bash
npm run build   # outputs to dist/
```
