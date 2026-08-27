import { supabase } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import type { XpressWalletAccount } from "../types";

/**
 * Client-side wrapper around Xpress Wallet (Providus Bank's wallet-as-a-
 * service API — see the "Xpress Wallet" Postman collection for the full
 * endpoint list). This is the wallet-funding rail: every MHU Global user
 * gets their own dedicated virtual account (issued at Providus Bank) that
 * they transfer real money into to fund their in-app wallet.
 *
 * Two Supabase Edge Functions do the actual API talking, because Xpress
 * Wallet's secret key (sk_sandbox_xxx / sk_live_xxx) must never reach the
 * browser:
 *
 *   - xpresswallet-create-wallet: called once per user (after they submit
 *     BVN/DOB/address) to create their Customer + Wallet on Xpress
 *     Wallet's side via POST /wallet, then stores the returned virtual
 *     account in the `xpresswallet_accounts` table.
 *   - xpresswallet-webhook: a public endpoint Xpress Wallet calls whenever
 *     money lands in one of those virtual accounts. It credits the
 *     matching user's `wallets.balance` and logs a transaction. Configure
 *     its URL as the merchant's callbackURL/sandboxCallbackURL in the
 *     Xpress Wallet dashboard (see README.md).
 *
 * In demo mode there's no real account to fetch or create — FundWallet.tsx
 * shows a fabricated Providus Bank account instead, so this module is
 * simply not called.
 *
 * REPLACE: nothing here — set XPRESSWALLET_BASE_URL, XPRESSWALLET_SECRET_KEY
 * and XPRESSWALLET_WEBHOOK_SECRET as Supabase function secrets once you
 * have real Xpress Wallet merchant credentials.
 */

export interface CreateXpressWalletInput {
  bvn: string;
  dateOfBirth: string; // YYYY-MM-DD
  address: string;
}

export async function getMyAccount(): Promise<XpressWalletAccount | null> {
  if (isDemoMode) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("xpresswallet_accounts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as XpressWalletAccount | null;
}

export async function createAccount(input: CreateXpressWalletInput): Promise<XpressWalletAccount> {
  const { data, error } = await supabase.functions.invoke("xpresswallet-create-wallet", {
    body: input,
  });
  if (error) throw new Error(error.message ?? "Could not create your funding account");
  return data as XpressWalletAccount;
}
