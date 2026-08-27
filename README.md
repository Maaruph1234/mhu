# MHU Global — Web App

A React + TypeScript + Tailwind web app for MHU Global: a wallet that covers
airtime, data, TV subscriptions, electricity bills, exam pins and instant
peer-to-peer transfers. Visual style is a dark fintech theme inspired by
chain.com. Backend: Supabase (auth, database, edge functions, and built-in
email OTP for signup verification), VTpass (airtime/data/TV/electricity/
exam-pin fulfillment), Korapay (wallet funding via bank transfer).

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

### Wallet funding — Korapay
VTpass only handles outgoing bill payments — it has no concept of depositing
money into a wallet. Wallet funding is wired to Korapay (see
developers.korapay.com), using their NGN Virtual Bank Account product. Every
endpoint/field/webhook shape below is confirmed directly against Korapay's
own docs, not guessed:
- Run the schema additions in `supabase/schema.sql` — adds the new
  `korapay_accounts` table (1:1 with `users`).
- Set Supabase function secrets:
  ```bash
  supabase secrets set KORAPAY_SECRET_KEY=sk_test_xxx KORAPAY_BASE_URL=https://api.korapay.com KORAPAY_BANK_CODE=000
  ```
  `KORAPAY_BANK_CODE=000` is required while using test/sandbox keys — switch
  to a real bank code (e.g. `035` Wema, `070` Fidelity) once you move to
  live keys. Korapay uses the same base URL for both test and live; the
  `sk_test_`/`sk_live_` prefix on your secret key determines the mode.
- Deploy both new edge functions:
  `supabase functions deploy korapay-create-account` and
  `supabase functions deploy korapay-webhook --no-verify-jwt` (the
  `--no-verify-jwt` flag matters — Korapay calls the webhook directly, with
  no Supabase user session attached).
- In your Kora dashboard, go to **Settings > API Configuration** and set the
  Webhook URL to your deployed `korapay-webhook` function's URL. Unlike the
  abandoned Xpress Wallet attempt, no secret-in-query-param scheme is
  needed — Korapay signs every webhook with an `x-korapay-signature` header
  (HMAC-SHA256 of the `data` object, using your secret key), which
  `korapay-webhook/index.ts` verifies before doing anything.
- On first visit to Fund Wallet, a user submits their BVN once (Korapay
  requires BVN or NIN for KYC on every virtual account, by regulation) —
  `korapay-create-account` calls Korapay's Create Virtual Bank Account API
  and stores the returned account. From then on they see their real
  dedicated account number instead of a placeholder, and transfers to it
  credit their wallet automatically via the webhook (event
  `charge.success`).
- **Testing on sandbox:** use test BVN `22222222222` (see Korapay's
  Testing Your Integration doc). To simulate a real bank transfer landing
  in a sandbox virtual account without actually sending money, POST to
  `https://api.korapay.com/merchant/api/v1/virtual-bank-account/sandbox/credit`
  with `{ account_number, currency: "NGN", amount }` using your test secret
  key — this triggers a real `charge.success` webhook to your deployed
  function, so it's the fastest way to confirm the whole flow end-to-end.
- Korapay defaults to a 50-virtual-account limit per merchant; email
  support@korapay.com to raise it before real users start signing up at
  volume.

### Transfer to bank — Korapay Payout API
The Transfer page has two tabs: "Transfer to MHU user" (the original
wallet-to-wallet `transfer_funds` RPC, unchanged) and "Transfer to bank" —
sending money OUT of a user's wallet to any external Nigerian bank account,
via a different Korapay product than the funding side above. Confirmed
directly against developers.korapay.com/docs/payout-via-api:
- No schema changes needed — reuses the existing `transactions` table (a
  `bank_transfer_out` row is inserted with status `pending` at initiation).
- Uses the same `KORAPAY_SECRET_KEY`/`KORAPAY_BASE_URL` secrets as the
  funding side — no new secrets to set.
- Deploy the new edge function: `supabase functions deploy korapay-payout`.
- Flow: `korapay-payout/index.ts` lists Nigerian banks (`action: "banks"`),
  resolves an account number to a name before paying (`action: "resolve"`,
  shown in the UI so the user can confirm who they're sending to), then
  calls Korapay's `/transactions/disburse` endpoint. The wallet is debited
  immediately (optimistically) and the transaction sits as `pending`.
- `korapay-webhook/index.ts` was extended to also handle `transfer.success`
  / `transfer.failed` events (on top of the `charge.success` funding event
  it already handled) — these resolve that `pending` row to `successful`,
  or to `failed` **and automatically refund the wallet**, since Korapay's
  own docs explicitly warn that a payout API response of "processing" is
  not a guarantee of final outcome — only the webhook is authoritative.
- **Sandbox test bank accounts** (per Korapay's Testing Your Integration
  doc): bank code `044` (Access Bank), `033` (UBA), or `058` (GTCO) with
  account number `0000000000` simulate a successful payout in test mode.

### Registration identity check — Korapay BVN Lookup
Register.tsx now collects first name, last name, phone, and BVN, and declines
the signup outright if they don't match Korapay's BVN records — no Supabase
Auth account is created until the check passes. Confirmed directly against
developers.korapay.com/docs/nigeria-bvn:
- No schema changes, and nothing is persisted — the BVN and Korapay's
  response are used only for the one pass/fail check, same policy as
  `korapay-create-account`.
- Uses the same `KORAPAY_SECRET_KEY`/`KORAPAY_BASE_URL` secrets as every
  other Korapay function.
- Deploy: `supabase functions deploy korapay-verify-bvn --no-verify-jwt` —
  the `--no-verify-jwt` flag matters here too: this runs *before* the user
  has a Supabase session (it's the gate deciding whether to create one).
- Flow: `korapay-verify-bvn/index.ts` calls Korapay's BVN Lookup
  (`POST /merchant/api/v1/identities/ng/bvn`) with `validation.first_name` /
  `validation.last_name`, which comes back with `true`/`false` match flags.
  Korapay doesn't validate phone number itself, so the function separately
  compares the BVN record's own `phone_number` against what was typed,
  normalized the same way `normalize_ng_phone()` already does for transfers.
  Registration is only allowed to continue if first name, last name, *and*
  phone all match.
- **This requires Korapay's Identity product to be enabled on your account**
  (a separate toggle from Payments/Payouts) — if every attempt fails with an
  auth/permission error, that's an account setting on the Kora dashboard,
  the same class of issue as VTpass's per-product whitelisting.
- **Testing on sandbox:** only BVN `22222222222` resolves to real test data
  — first name `Trevor`, last name `Mandela`, phone `08031234567` (per
  Korapay's Testing Your Integration doc). Use those exact values to test a
  successful registration, and any mismatched name/phone with the same BVN
  to test a decline. BVN `00000000000` is the documented invalid case.

### Xpress Wallet (not currently used — left in place, unused)
Xpress Wallet (Providus Bank) was the original wallet-funding attempt, but
its Postman-collection-based field names and webhook payload shape were
never confirmed against a real account before the project moved to Korapay.
`src/lib/xpressWallet.ts` and `supabase/functions/xpresswallet-create-wallet/`
+ `xpresswallet-webhook/` are left in the codebase, unused, in case it's
worth revisiting. `FundWallet.tsx` no longer imports from `lib/korapay`'s
predecessor — it uses Korapay exclusively.

### App Store / Play Store badges
- Set `VITE_APP_STORE_URL` and `VITE_PLAY_STORE_URL` in `.env` once the
  Flutter app has real listing pages. Until then the badges link to `#`.

## 3. Project structure

```
src/
  components/ui/       Buttons, cards, inputs, wallet card, store badges, etc.
  components/layout/   Marketing nav/footer, dashboard sidebar, auth layout
  context/              AuthContext (Supabase auth), WalletContext (balance + transactions)
  lib/                  supabaseClient, smsala.ts, vtpass.ts, provibill.ts, korapay.ts, xpressWallet.ts, format.ts (client-side service wrappers -- provibill.ts/xpressWallet.ts unused, kept for reference)
  data/reference.ts     Static network/TV/disco/exam-body reference data (placeholders — see above)
  pages/marketing/      Landing page
  pages/auth/           Login, Register, OTP verification, Forgot password
  pages/dashboard/      Overview, Fund, Transfer, Airtime, Data, TV, Electricity, Exam Pins, Transactions, Referrals, Profile
supabase/
  schema.sql             Tables, RLS policies, transfer_funds RPC
  functions/              Edge functions that hold the real VTpass/Smsala/Korapay secret keys (plus unused Provibill/Xpress Wallet ones)
```

## 4. Why VTpass/Korapay/Smsala calls go through Supabase Edge Functions

VTpass, Korapay, and Smsala all require secret credentials. Secrets must
never ship in frontend JavaScript (anyone can open dev tools and read
them), so `src/lib/vtpass.ts`, `src/lib/korapay.ts`, and `src/lib/smsala.ts`
never call those APIs directly — they call a Supabase Edge Function
(`supabase.functions.invoke(...)`), and the edge function (which runs
server-side, holding the real secrets) makes the actual VTpass/Korapay/
Smsala request.

## 5. Build

```bash
npm run build   # outputs to dist/
```
