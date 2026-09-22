// PARTIALLY ACTIVE: only verifyBvn/verifyNin (identity checks at signup,
// called from Register.tsx via the payvessel.ts shim) are still live. The
// wallet-funding/payout functions below (getMyAccount, createAccount,
// listBanks, resolveAccount, checkTransferStatus, payoutToBank) are NOT
// called by anything anymore -- Xpress Wallet replaced Korapay for wallet
// funding and bank payouts (Sept 2026, see src/lib/xpressWallet.ts and
// payvessel.ts's header comment). Left in place unused rather than
// deleted, in case Korapay is ever revisited.
import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import type { KorapayAccount } from "../types";

/**
 * Client-side wrapper around Korapay (see developers.korapay.com).
 * verifyBvn/verifyNin below are the live part of this file -- identity
 * checks at registration (see Register.tsx), via two public/no-JWT edge
 * functions (korapay-verify-bvn, korapay-verify-nin) since they run before
 * signup.
 *
 * Everything else here (getMyAccount, createAccount, listBanks,
 * resolveAccount, checkTransferStatus, payoutToBank) was the wallet-funding
 * rail before Xpress Wallet replaced it: every user got a permanent NGN
 * Virtual Bank Account via korapay-create-account (POST
 * /merchant/api/v1/virtual-bank-account), funded/credited via
 * korapay-webhook (events "charge.success"/"transfer.success"/
 * "transfer.failed", x-korapay-signature verified), with korapay-payout
 * handling "Transfer to bank". All three edge functions are still deployed
 * and functionally correct, just unused -- nothing client-side calls them
 * anymore.
 *
 * In demo mode there's no real account to fetch or create -- FundWallet.tsx
 * shows a fabricated bank account instead, so this module is simply not
 * called.
 */

export interface CreateKorapayAccountInput {
  bvn: string;
  nin?: string;
}

export async function getMyAccount(): Promise<KorapayAccount | null> {
  if (isDemoMode) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("korapay_accounts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as KorapayAccount | null;
}

export async function createAccount(input: CreateKorapayAccountInput): Promise<KorapayAccount> {
  const { data, error } = await supabase.functions.invoke("korapay-create-account", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as KorapayAccount;
}

/**
 * BVN identity check used at registration -- the name and phone number
 * someone types on the signup form must match what Korapay's BVN Lookup API
 * (developers.korapay.com/docs/nigeria-bvn) returns for that BVN, or
 * registration is declined before an account is ever created. Called
 * *before* supabase.auth.signUp(), so this hits a public/no-JWT edge
 * function (korapay-verify-bvn) rather than one gated behind a session.
 */
export interface VerifyBvnInput {
  bvn: string;
  firstName: string;
  lastName: string;
  phone: string;
}

export interface VerifyBvnResult {
  verified: boolean;
  reason?: string;
  // Kora's Basic-style lookup (unlike Payvessel's Basic BVN/NIN, which
  // returned only match verdicts) does hand back the record's own data, but
  // there's no reason to distrust what the user typed once it's matched --
  // kept as verdict-only here to match the established call-site contract
  // (Register.tsx already just uses what was typed on a verified: true).
  phoneWarning?: string | null;
}

export async function verifyBvn(input: VerifyBvnInput): Promise<VerifyBvnResult> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 700));
    return { verified: true };
  }
  const { data, error } = await supabase.functions.invoke("korapay-verify-bvn", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as VerifyBvnResult;
}

export interface VerifyNinInput {
  nin: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: "MALE" | "FEMALE";
  birthday: string;
  phone: string;
}

// Real Kora NIN Lookup (merchant/api/v1/identities/ng/nin) via its own
// edge function -- previously this just re-routed the NIN value through the
// BVN endpoint's `bvn` field, which would never validly match against Kora's
// BVN records.
export async function verifyNin(input: VerifyNinInput): Promise<VerifyBvnResult> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 700));
    return { verified: true };
  }
  const { data, error } = await supabase.functions.invoke("korapay-verify-nin", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as VerifyBvnResult;
}

/**
 * "Transfer to bank" -- sending money OUT of the wallet to an external
 * Nigerian bank account, via Korapay's Payout API (a different product
 * from the virtual-account funding above). Routed through the
 * `korapay-payout` Edge Function for the same secret-key reasons.
 */
export interface KorapayBank {
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

export async function listBanks(): Promise<KorapayBank[]> {
  if (isDemoMode) {
    return [
      { name: "Access Bank", code: "044" },
      { name: "GTBank", code: "058" },
      { name: "UBA", code: "033" },
      { name: "Zenith Bank", code: "057" },
    ];
  }
  const { data, error } = await supabase.functions.invoke("korapay-payout", {
    body: { action: "banks" },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return (data as { banks: KorapayBank[] }).banks;
}

export async function resolveAccount(bankCode: string, accountNumber: string): Promise<string> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 500));
    return "Chidinma Okafor";
  }
  const { data, error } = await supabase.functions.invoke("korapay-payout", {
    body: { action: "resolve", bankCode, accountNumber },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return (data as { accountName: string }).accountName;
}

export async function checkTransferStatus(reference: string): Promise<"pending" | "successful" | "failed"> {
  if (isDemoMode) return "successful";
  try {
    const { data, error } = await supabase.functions.invoke("korapay-payout", {
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
  const { data, error } = await supabase.functions.invoke("korapay-payout", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as BankPayoutResult;
}
