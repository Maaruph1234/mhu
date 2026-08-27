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
}

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

// Not currently used (Xpress Wallet connectivity was never confirmed) --
// Korapay is the active wallet-funding provider. Kept here in case Xpress
// Wallet gets revisited later; nothing in the app references this type.
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
  | "referral_bonus";

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
