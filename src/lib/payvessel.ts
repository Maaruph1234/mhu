// This module is a thin re-export shim, kept so existing imports across
// Register.tsx, Transfer.tsx, Transactions.tsx etc. don't need to change
// every time the underlying provider does. Two different things live
// behind this one name now, reflecting two independent provider switches:
//
//   - verifyBvn/verifyNin (identity verification, used at signup) still
//     forward to Korapay (src/lib/korapay.ts) -- unrelated to wallet
//     funding, not touched by the Sept 2026 switch below.
//   - listBanks/resolveAccount/checkTransferStatus/payoutToBank ("Send to
//     Bank") now forward to Xpress Wallet (src/lib/xpressWallet.ts) --
//     switched back from Korapay, Sept 2026, alongside wallet funding.
//
// Wallet-funding account creation (createAccount/getMyAccount) used to live
// here too, forwarding to whichever provider was active -- that's gone now
// because Xpress Wallet's create-wallet call needs a different input shape
// (bvn + dateOfBirth + address, not bvn + nin), so FundWallet.tsx imports
// src/lib/xpressWallet.ts directly instead of going through this shim.
import {
  verifyBvn as verifyKorapayBvn,
  verifyNin as verifyKorapayNin,
} from "./korapay";
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
  return verifyKorapayBvn(input);
}

export async function verifyNin(input: VerifyNinInput): Promise<VerifyNinResult> {
  return verifyKorapayNin(input);
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
