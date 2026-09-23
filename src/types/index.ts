// These types mirror the REAL production Supabase schema already used by
// the MHU Global Flutter app (project "mhu-app") — not an invented schema.
// Table is `users` (not `profiles`), wallet balance is a plain column
// (`wallet_balance`) rather than a separate `wallets` table, and
// `transactions` uses `title`/`subtitle` rather than `description`/`fee`.
// There is no `referral_code`, `bvn`, `date_of_birth`, or `address` column
// on `users` — see src/pages/dashboard/Referrals.tsx and
// src/lib/xpressWallet.ts for how those are handled without one.

export interface Profile {
  id: string;
  phone_number: string;
  display_name: string | null;
  email: string | null;
  wallet_balance: number | null;
  user_type?: string | null;
  account_number?: string | null;
  is_online?: boolean | null;
  business_name?: string | null;
  created_at: string;
  // KYC tier (Sept 2026, see supabase/schema.sql's "KYC tier system"
  // block): 1 = just signed up, 2 = BVN verified via Xpress Wallet,
  // 3 = enhanced verification, manually reviewed. Defaults to 1 in the DB,
  // so this is realistically always a number once loaded -- optional only
  // because it's absent on very old cached/mocked Profile objects.
  kyc_tier?: 1 | 2 | 3;
}

export type Tier3DocumentType = "utility_bill" | "drivers_license" | "voters_card" | "passport" | "nin_slip";

export interface Tier3Verification {
  id: string;
  user_id: string;
  document_type: Tier3DocumentType;
  document_url: string;
  status: "pending" | "approved" | "rejected";
  reviewer_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

// ACTIVE -- Xpress Wallet (Providus Bank) is the current wallet-funding
// provider (switched back from Korapay, Sept 2026 -- see
// src/lib/xpressWallet.ts and .env.example). Unlike Korapay/Payvessel
// before it, the dedicated account this creates is a REAL Providus Bank
// account with its own live balance, not a pass-through virtual account --
// see src/lib/xpressWallet.ts's header comment.
export interface XpressWalletAccount {
  id: string;
  user_id: string;
  xw_customer_id: string;
  xw_wallet_id: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// NO LONGER ACTIVE -- Korapay was the wallet-funding provider before Xpress
// Wallet replaced it (Sept 2026). src/lib/korapay.ts and
// src/lib/payvessel.ts (a thin re-export shim over it) are left in place
// unused rather than deleted, in case any historical rows need to be
// referenced later. PayvesselAccount below is the same story, one provider
// further back.
export interface KorapayAccount {
  id: string;
  user_id: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  account_reference: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// No longer the active wallet-funding provider (switched back to Korapay --
// see KorapayAccount above) -- src/lib/payvessel.ts now just re-exports this
// name as an alias for KorapayAccount so existing imports (FundWallet.tsx
// etc.) don't need to change. Payvessel virtual USD cards (a separate
// feature, supabase/functions/payvessel-cards) are untouched by that switch
// and still live -- this type isn't used for those.
export interface PayvesselAccount {
  id: string;
  user_id: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  tracking_reference?: string;
  account_reference?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// Payvessel-issued USD virtual card (Visa/Mastercard). Matches the
// `virtual_cards` table in supabase/schema.sql -- deliberately has no
// card_number/cvv columns; those are fetched live from
// payvessel-cards' "get" action only when the user asks to view them, never
// persisted. See supabase/functions/payvessel-cards/index.ts for why this
// table exists at all (Payvessel has no per-customer card list of its own).
export interface VirtualCard {
  id: string;
  user_id: string;
  payvessel_card_id: string;
  brand: string;
  currency: string;
  card_name: string | null;
  masked_pan: string;
  status: "PENDING" | "ACTIVE" | "FROZEN" | "TERMINATED" | "FAILED";
  balance_usd: number;
  created_at: string;
  updated_at: string;
}

// Full card detail returned only from an explicit "reveal" request --
// never stored in state longer than the viewing session.
export interface VirtualCardDetail extends Omit<VirtualCard, "status"> {
  status: string;
  expiry?: string;
  card_number?: string;
  cvv?: string;
}

export interface VirtualCardTransaction {
  id: string;
  card_id: string;
  ref_id?: string;
  amount: string;
  currency: string;
  merchant?: string;
  entry: "DEBIT" | "CREDIT";
  status: string;
  type: string;
  description?: string;
  fee?: string;
  date: string;
}

export type IdentityDocType = "nin" | "drivers_license" | "voters_card" | "passport";

// Matches the `identity_verifications` table in supabase/schema.sql -- one
// row per user per document type, written only by the payvessel-identity
// edge function. Never includes a photo (deliberately not stored, see that
// table's comment).
export interface IdentityVerification {
  id: string;
  user_id: string;
  doc_type: IdentityDocType;
  doc_number: string;
  verified_name: string | null;
  status: string;
  details: Record<string, unknown>;
  created_at: string;
}

// Matches Payvessel's PackageSchema (esim/list-packages) -- passed through
// mostly as-is rather than re-typed field by field.
export interface EsimPackage {
  package_code: string;
  name: string;
  currency_code: string;
  price_usd: number;
  price_naira: number | null;
  volume_bytes: number;
  duration: number;
  duration_unit: string;
  location: string;
  description: string | null;
  favorite?: boolean | null;
  speed?: string | null;
}

export interface EsimRegion {
  code: string;
  name: string;
  sub_locations?: EsimRegion[];
}

// Matches the `esim_orders` table in supabase/schema.sql.
export interface EsimOrder {
  id: string;
  user_id: string;
  payvessel_order_id: string;
  reference: string;
  package_code: string;
  package_name: string;
  location: string;
  amount_ngn: number;
  status: "pending" | "processing" | "completed" | "failed";
  qr_code_url: string | null;
  iccid: string | null;
  activation_details: Record<string, unknown>;
  created_at: string;
}

export interface FlightAirport {
  airport_code: string;
  airport_name: string;
  city_country: string;
  city: string;
  country: string;
}

export interface FlightPricing {
  currency_code: string;
  base_price: number;
  service_charge: number;
  total_amount: number;
  wallet_reward_on_success: number;
  price_status: "preview" | "final";
}

export interface FlightSearchOption {
  selection_token: string;
  pricing: FlightPricing;
  airline_code: string | null;
  airline_name: string | null;
  airline_logo_url: string | null;
  is_refundable: boolean | null;
  journeys: Array<{
    departure_airport_code: string | null;
    departure_airport_name: string | null;
    arrival_airport_code: string | null;
    arrival_airport_name: string | null;
    departure_datetime: string | null;
    arrival_datetime: string | null;
    stop_count: number | null;
    trip_duration: string | null;
  }>;
}

export interface FlightQuote {
  id: string;
  airlineName: string | null;
  airlineLogoUrl?: string | null;
  journeys: FlightSearchOption["journeys"];
  pricing: FlightPricing;
  expiresAt: string;
  amountNgn: number;
}

export interface FlightPassengerInput {
  passenger_type: "Adult" | "Child" | "Infant";
  first_name: string;
  last_name: string;
  middle_name?: string;
  date_of_birth?: string;
  email?: string;
  phone_number?: string;
  gender?: string;
}

// Matches the `flight_orders` table in supabase/schema.sql.
export interface FlightOrder {
  id: string;
  user_id: string;
  payvessel_order_id: string;
  merchant_reference: string;
  route_summary: string;
  amount_ngn: number;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  passengers: FlightPassengerInput[];
  created_at: string;
}

// Not a real table — synthesized in WalletContext from `users.wallet_balance`
// so the rest of the app (WalletCard, Transfer, Dashboard) can keep reading
// `wallet.balance` / `wallet.currency` without change.
export interface Wallet {
  balance: number;
  currency: string;
}

export type TransactionType =
  | "fund_wallet"
  | "transfer_out"
  | "transfer_in"
  | "bank_transfer_out"
  | "airtime"
  | "data"
  | "tv"
  | "electricity"
  | "exam_pin"
  | "referral_bonus"
  | "card_create"
  | "card_fund"
  | "card_withdraw"
  | "card_terminate"
  | "card_fee"
  | "identity_verification"
  | "esim_purchase"
  | "flight_booking";

export type TransactionStatus = "pending" | "successful" | "failed";

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  reference: string;
  title: string;
  subtitle?: string | null;
  created_at: string;
}

export interface Network {
  id: string;
  name: string;
  color: string;
  /** Path to the network's logo image (public/networks/*.png), if available. */
  logo?: string;
}

export interface DataPlan {
  id: string;
  network: string;
  name: string;
  size: string;
  validity: string;
  price: number;
}

export interface TvProvider {
  id: string;
  name: string;
  logo?: string;
}

export interface TvPlan {
  id: string;
  provider: string;
  name: string;
  price: number;
}

export interface Disco {
  id: string;
  name: string;
  fullName: string;
}

export interface ExamBody {
  id: string;
  name: string;
  fullName: string;
  price: number;
}
