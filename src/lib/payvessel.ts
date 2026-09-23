// This module is a thin re-export shim, kept so existing imports across
// Register.tsx, Transfer.tsx, Transactions.tsx etc. don't need to change
// every time the underlying provider does. Two different things live
// behind this one name now, reflecting two independent provider switches:
//
//   - verifyBvn/verifyNin (identity verification, used at signup) call the
//     REAL Payvessel identity-verification product directly (Basic NIN/BVN
//     Verification -- see supabase/functions/payvessel-verify-nin and
//     payvessel-verify-bvn) -- a completely different Payvessel product from
//     the old wallet-funding one that got replaced by Xpress Wallet below.
//     Payvessel is NOT Korapay and NOT Xpress Wallet -- it's a third,
//     separate provider that's only ever done identity verification here.
//     FIXED Sept 2026: this used to forward to Korapay's verify-nin/verify-bvn
//     (src/lib/korapay.ts) even though Register.tsx's own comments and the
//     payvessel-verify-nin edge function already assumed Payvessel -- a
//     leftover from an incomplete migration. The Flutter app's
//     register_screen.dart already called payvessel-verify-nin directly and
//     never had this bug; this brings the website in line with it and
//     removes the last live Korapay call anywhere in either codebase.
//   - listBanks/resolveAccount/checkTransferStatus/payoutToBank ("Send to
//     Bank") forward to Xpress Wallet (src/lib/xpressWallet.ts) -- switched
//     back from Korapay, Sept 2026, alongside wallet funding.
//
// Wallet-funding account creation (createAccount/getMyAccount) used to live
// here too, forwarding to whichever provider was active -- that's gone now
// because Xpress Wallet's create-wallet call needs a different input shape
// (bvn + dateOfBirth + address, not bvn + nin), so FundWallet.tsx imports
// src/lib/xpressWallet.ts directly instead of going through this shim.
import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import {
  listBanks as listXpressWalletBanks,
  resolveAccount as resolveXpressWalletAccount,
  checkTransferStatus as checkXpressWalletTransferStatus,
  payoutToBank as payoutXpressWalletToBank,
  type XpressWalletBank,
  type BankPayoutInput as XpressWalletBankPayoutInput,
  type BankPayoutResult as XpressWalletBankPayoutResult,
} from "./xpressWallet";

export type PayvesselBank = XpressWalletBank;
export type BankPayoutInput = XpressWalletBankPayoutInput;
export type BankPayoutResult = XpressWalletBankPayoutResult;

export interface VerifyBvnInput {
  bvn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: "MALE" | "FEMALE";
  birthday: string;
  phone: string;
}

export interface VerifyBvnResult {
  verified: boolean;
  reason?: string;
  matchPercentage?: number | null;
  phoneWarning?: string | null;
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

export type VerifyNinResult = VerifyBvnResult;

export async function verifyBvn(input: VerifyBvnInput): Promise<VerifyBvnResult> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 700));
    return { verified: true };
  }
  const { data, error } = await supabase.functions.invoke("payvessel-verify-bvn", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as VerifyBvnResult;
}

export async function verifyNin(input: VerifyNinInput): Promise<VerifyNinResult> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 700));
    return { verified: true };
  }
  const { data, error } = await supabase.functions.invoke("payvessel-verify-nin", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as VerifyNinResult;
}

export async function listBanks(): Promise<PayvesselBank[]> {
  return listXpressWalletBanks();
}

export async function resolveAccount(bankCode: string, accountNumber: string): Promise<string> {
  return resolveXpressWalletAccount(bankCode, accountNumber);
}

export async function checkTransferStatus(reference: string): Promise<"pending" | "successful" | "failed"> {
  return checkXpressWalletTransferStatus(reference);
}

export async function payoutToBank(input: BankPayoutInput): Promise<BankPayoutResult> {
  return payoutXpressWalletToBank(input);
}
