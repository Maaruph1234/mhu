import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import type { XpressWalletAccount } from "../types";

/**
 * Client-side wrapper around Xpress Wallet (Providus Bank's wallet-as-a-
 * service API -- see developer.providusbank.com/xpress-wallet-api, the
 * live Providus docs). ACTIVE wallet-funding *and* withdrawal provider,
 * switched back from Korapay (Sept 2026) -- see .env.example and
 * README.md for the full history.
 *
 * Unlike Korapay/Payvessel before it, the account this creates is a REAL
 * Providus Bank account with its own live balance ("availableBalance") on
 * Xpress Wallet's side -- not a pass-through virtual account. This app
 * still treats `users.wallet_balance` as the single source of truth for
 * spending everywhere else (same pattern as every other provider here);
 * Xpress Wallet is the funding rail (deposits, via the dedicated account
 * below) and the withdrawal rail (Send to Bank, via payoutToBank), kept in
 * sync with our own ledger by the edge functions below rather than by
 * reading Xpress Wallet's balance directly everywhere.
 *
 * Three Supabase Edge Functions do the actual API talking, because Xpress
 * Wallet's merchant credentials must never reach the browser:
 *
 *   - xpresswallet-create-wallet: called once per user (after they submit
 *     BVN/DOB/address) to create their Customer + Wallet on Xpress
 *     Wallet's side via POST /wallet, then stores the returned dedicated
 *     account in the `xpresswallet_accounts` table.
 *   - xpresswallet-webhook: a public endpoint Xpress Wallet calls whenever
 *     money lands in one of those dedicated accounts. It credits the
 *     matching user's `wallet_balance` and logs a transaction. Configure
 *     its URL as the merchant's callbackURL/sandboxCallbackURL (see
 *     README.md).
 *   - xpresswallet-transfer: "Send to Bank" -- sends money OUT of a user's
 *     real Xpress Wallet sub-account to an external bank via
 *     POST /transfer/bank/customer, debiting `wallet_balance` only once
 *     Xpress Wallet confirms the transfer succeeded.
 *
 * In demo mode there's no real account to fetch or create -- FundWallet.tsx
 * shows a fabricated Providus Bank account instead, so this module is
 * simply not called for account creation (the transfer functions below
 * still have demo-mode branches, matching every other provider's pattern,
 * since Send to Bank is reachable from demo mode too).
 *
 * REPLACE: set XPRESSWALLET_BASE_URL, XPRESSWALLET_EMAIL,
 * XPRESSWALLET_PASSWORD, and XPRESSWALLET_PRIVATE_KEY as Supabase function
 * secrets once you have real Xpress Wallet merchant credentials (see
 * supabase/functions/_shared/xpresswallet-auth.ts for what each does).
 */

export interface CreateXpressWalletInput {
  bvn: string;
  dateOfBirth: string; // YYYY-MM-DD
  address: string;
}

export interface XpressWalletBank {
  name: string;
  code: string;
}

export interface BankPayoutInput {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  narration?: string;
}

export interface BankPayoutResult {
  success: boolean;
  reference: string;
  message: string;
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
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as XpressWalletAccount;
}

export async function listBanks(): Promise<XpressWalletBank[]> {
  if (isDemoMode) {
    return [
      { name: "Access Bank", code: "044" },
      { name: "GTBank", code: "058" },
      { name: "UBA", code: "033" },
      { name: "Zenith Bank", code: "057" },
    ];
  }
  const { data, error } = await supabase.functions.invoke("xpresswallet-transfer", {
    body: { action: "banks" },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return (data as { banks: XpressWalletBank[] }).banks;
}

export async function resolveAccount(bankCode: string, accountNumber: string): Promise<string> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 500));
    return "Chidinma Okafor";
  }
  const { data, error } = await supabase.functions.invoke("xpresswallet-transfer", {
    body: { action: "resolve", bankCode, accountNumber },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return (data as { accountName: string }).accountName;
}

export async function checkTransferStatus(reference: string): Promise<"pending" | "successful" | "failed"> {
  if (isDemoMode) return "successful";
  try {
    const { data, error } = await supabase.functions.invoke("xpresswallet-transfer", {
      body: { action: "status", reference },
    });
    if (error) return "pending";
    return (data as { status?: "pending" | "successful" | "failed" })?.status ?? "pending";
  } catch {
    return "pending";
  }
}

export async function payoutToBank(input: BankPayoutInput): Promise<BankPayoutResult> {
  if (isDemoMode) {
    const { demoStore } = await import("./demoStore");
    await new Promise((r) => setTimeout(r, 900));
    const wallet = demoStore.getWallet();
    const reference = `TRFBANK-${Date.now()}`;
    if (input.amount > wallet.balance) {
      return { success: false, reference, message: "Insufficient wallet balance" };
    }
    demoStore.record(
      {
        type: "bank_transfer_out",
        amount: input.amount,
        status: "successful",
        reference,
        title: `Bank transfer to ${input.accountName || input.accountNumber}`,
      },
      -input.amount
    );
    return { success: true, reference, message: "Bank transfer successful" };
  }
  const { data, error } = await supabase.functions.invoke("xpresswallet-transfer", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as BankPayoutResult;
}
